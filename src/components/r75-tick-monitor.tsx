import React, {
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react';

import { api_base } from '../external/bot-skeleton/services/api/api-base';

const MARKET_SYMBOL = 'frxEURUSD';
const MARKET_NAME = 'EUR/USD';

const HISTORY_SIZE = 500;
const PAPER_TEST_LIMIT = 1000;
const BLOCK_SIZE = 100;
const ANALYSIS_WINDOW = 20;

type Direction = 'UP' | 'DOWN' | 'FLAT';

type Tick = {
    quote: number;
    epoch: number;
};

type Stats = {
    total: number;
    wins: number;
    losses: number;
    rate: number;
    virtualPnL: number;
};

type BalanceInfo = {
    balance: number | null;
    currency: string;
    loginid: string;
};

type TestMode = 'idle' | 'running' | 'finished';

type ProposalInfo = {
    status: 'idle' | 'loading' | 'success' | 'error';
    id?: string;
    contractType?: string;
    payout?: number;
    askPrice?: number;
    message?: string;
};

type DiagnosticInfo = {
    apiExists: boolean;
    initStarted: boolean;
    initFinished: boolean;
    streamCreated: boolean;
    subscriptionCreated: boolean;
    tickRequestSent: boolean;
    balanceRequestSent: boolean;
    messagesReceived: number;
    ticksReceived: number;
    lastMessageType: string;
    lastTickEpoch: number | null;
    lastTickQuote: number | null;
    lastError: string;
    apiKeys: string;
};

const EMPTY_STATS: Stats = {
    total: 0,
    wins: 0,
    losses: 0,
    rate: 0,
    virtualPnL: 0,
};

const EMPTY_DIAGNOSTIC: DiagnosticInfo = {
    apiExists: false,
    initStarted: false,
    initFinished: false,
    streamCreated: false,
    subscriptionCreated: false,
    tickRequestSent: false,
    balanceRequestSent: false,
    messagesReceived: 0,
    ticksReceived: 0,
    lastMessageType: '—',
    lastTickEpoch: null,
    lastTickQuote: null,
    lastError: '',
    apiKeys: '—',
};

function calculateDirection(previous: number, current: number): Direction {
    if (!Number.isFinite(previous) || !Number.isFinite(current)) {
        return 'FLAT';
    }

    if (current > previous) {
        return 'UP';
    }

    if (current < previous) {
        return 'DOWN';
    }

    return 'FLAT';
}

function calculatePrediction(history: Tick[]): Direction {
    if (history.length < 2) {
        return 'FLAT';
    }

    const start = Math.max(0, history.length - ANALYSIS_WINDOW);
    const recent = history.slice(start);

    let up = 0;
    let down = 0;

    for (let i = 1; i < recent.length; i += 1) {
        const direction = calculateDirection(
            recent[i - 1].quote,
            recent[i].quote
        );

        if (direction === 'UP') {
            up += 1;
        } else if (direction === 'DOWN') {
            down += 1;
        }
    }

    if (up > down) {
        return 'UP';
    }

    if (down > up) {
        return 'DOWN';
    }

    return 'FLAT';
}

function getLastDigit(quote: number): number {
    if (!Number.isFinite(quote)) {
        return 0;
    }

    const text = quote.toFixed(5);
    const digits = text.replace(/\D/g, '');

    if (!digits) {
        return 0;
    }

    return Number(digits.slice(-1));
}

function getPredictionText(prediction: Direction): string {
    if (prediction === 'UP') {
        return '🟢 HAUSSE';
    }

    if (prediction === 'DOWN') {
        return '🔴 BAISSE';
    }

    return '⚪ STABLE';
}

function getDirectionText(direction: Direction): string {
    if (direction === 'UP') {
        return '🟢 HAUSSE';
    }

    if (direction === 'DOWN') {
        return '🔴 BAISSE';
    }

    return '⚪ STABLE';
}

function getStrength(history: Tick[]): number {
    if (history.length < 2) {
        return 0;
    }

    const start = Math.max(0, history.length - ANALYSIS_WINDOW);
    const recent = history.slice(start);

    let up = 0;
    let down = 0;

    for (let i = 1; i < recent.length; i += 1) {
        const direction = calculateDirection(
            recent[i - 1].quote,
            recent[i].quote
        );

        if (direction === 'UP') {
            up += 1;
        } else if (direction === 'DOWN') {
            down += 1;
        }
    }

    const total = up + down;

    if (total === 0) {
        return 0;
    }

    return Math.round((Math.abs(up - down) / total) * 100);
}

function getProposalContractType(prediction: Direction): string {
    if (prediction === 'UP') {
        return 'CALL';
    }

    if (prediction === 'DOWN') {
        return 'PUT';
    }

    return '';
}

export default function R75TickMonitor() {
    const [connected, setConnected] = useState(false);
    const [statusMessage, setStatusMessage] = useState(
        '🟠 Initialisation du diagnostic…'
    );

    const [price, setPrice] = useState<number | null>(null);
    const [lastDigit, setLastDigit] = useState<number | null>(null);
    const [direction, setDirection] = useState<Direction>('FLAT');
    const [prediction, setPrediction] = useState<Direction>('FLAT');
    const [strength, setStrength] = useState(0);

    const [historyCount, setHistoryCount] = useState(0);

    const [paperStats, setPaperStats] =
        useState<Stats>(EMPTY_STATS);

    const [testMode, setTestMode] =
        useState<TestMode>('idle');

    const [balanceInfo, setBalanceInfo] =
        useState<BalanceInfo>({
            balance: null,
            currency: 'USD',
            loginid: '',
        });

    const [proposal, setProposal] =
        useState<ProposalInfo>({
            status: 'idle',
        });

    const [diagnostic, setDiagnostic] =
        useState<DiagnosticInfo>(EMPTY_DIAGNOSTIC);

    const historyRef = useRef<Tick[]>([]);

    const mountedRef = useRef(false);

    const previousQuoteRef =
        useRef<number | null>(null);

    const currentPredictionRef =
        useRef<Direction>('FLAT');

    const testModeRef =
        useRef<TestMode>('idle');

    const paperStatsRef =
        useRef<Stats>(EMPTY_STATS);

    const blockWinsRef =
        useRef(0);

    const blockLossesRef =
        useRef(0);

    const blockResultsRef =
        useRef<number[]>([]);

    const messageSubscriptionRef =
        useRef<{ unsubscribe?: () => void } | null>(null);

    const tickRequestSentRef =
        useRef(false);

    const balanceRequestSentRef =
        useRef(false);

    const initPromiseRef =
        useRef<Promise<unknown> | null>(null);

    const updateDiagnostic = useCallback(
        (changes: Partial<DiagnosticInfo>) => {
            setDiagnostic((previous) => ({
                ...previous,
                ...changes,
            }));
        },
        []
    );

    const resetPaperStats = useCallback(() => {
        const empty = { ...EMPTY_STATS };

        paperStatsRef.current = empty;
        blockWinsRef.current = 0;
        blockLossesRef.current = 0;
        blockResultsRef.current = [];

        setPaperStats(empty);
    }, []);

    const validatePreviousPrediction = useCallback(
        (newDirection: Direction) => {
            if (testModeRef.current !== 'running') {
                return;
            }

            const stats = paperStatsRef.current;
            const previousPrediction =
                currentPredictionRef.current;

            if (
                stats.total >= PAPER_TEST_LIMIT ||
                previousPrediction === 'FLAT' ||
                newDirection === 'FLAT'
            ) {
                return;
            }

            const win =
                previousPrediction === newDirection;

            const nextStats: Stats = {
                total: stats.total + 1,
                wins: stats.wins + (win ? 1 : 0),
                losses: stats.losses + (win ? 0 : 1),
                rate: 0,
                virtualPnL:
                    stats.virtualPnL + (win ? 1 : -1),
            };

            nextStats.rate =
                nextStats.total > 0
                    ? (nextStats.wins / nextStats.total) * 100
                    : 0;

            paperStatsRef.current = nextStats;
            setPaperStats(nextStats);

            blockResultsRef.current.push(win ? 1 : -1);

            if (win) {
                blockWinsRef.current += 1;
            } else {
                blockLossesRef.current += 1;
            }

            if (
                nextStats.total >= PAPER_TEST_LIMIT
            ) {
                testModeRef.current = 'finished';
                setTestMode('finished');
            }
        },
        []
    );

    const handleTick = useCallback(
        (tickData: any) => {
            const rawQuote = Number(tickData?.quote);

            if (!Number.isFinite(rawQuote)) {
                return;
            }

            const epoch = Number(
                tickData?.epoch ?? Date.now() / 1000
            );

            const previousQuote =
                previousQuoteRef.current;

            const newDirection =
                previousQuote === null
                    ? 'FLAT'
                    : calculateDirection(
                          previousQuote,
                          rawQuote
                      );

            validatePreviousPrediction(newDirection);

            previousQuoteRef.current = rawQuote;

            const newTick: Tick = {
                quote: rawQuote,
                epoch,
            };

            historyRef.current = [
                ...historyRef.current,
                newTick,
            ].slice(-HISTORY_SIZE);

            const nextHistory =
                historyRef.current;

            const nextPrediction =
                calculatePrediction(nextHistory);

            const nextStrength =
                getStrength(nextHistory);

            currentPredictionRef.current =
                nextPrediction;

            setPrice(rawQuote);
            setLastDigit(getLastDigit(rawQuote));
            setDirection(newDirection);
            setPrediction(nextPrediction);
            setStrength(nextStrength);
            setHistoryCount(nextHistory.length);

            updateDiagnostic({
                ticksReceived:
                    diagnostic.ticksReceived + 1,
                lastTickEpoch: epoch,
                lastTickQuote: rawQuote,
                lastMessageType: 'tick',
            });

            setConnected(true);
            setStatusMessage(
                '🟢 Connecté — ticks EUR/USD reçus'
            );

            if (
                testModeRef.current === 'idle' &&
                nextHistory.length >= 20
            ) {
                resetPaperStats();
                testModeRef.current = 'running';
                setTestMode('running');
            }
        },
        [
            diagnostic.ticksReceived,
            resetPaperStats,
            updateDiagnostic,
            validatePreviousPrediction,
        ]
    );

    const requestCurrentBalance =
        useCallback(() => {
            if (
                balanceRequestSentRef.current
            ) {
                return;
            }

            if (!api_base.api) {
                updateDiagnostic({
                    lastError:
                        'Balance : api_base.api est absent',
                });
                return;
            }

            try {
                balanceRequestSentRef.current = true;

                api_base.api.send({
                    balance: 1,
                    req_id: 4901,
                });

                updateDiagnostic({
                    balanceRequestSent: true,
                });
            } catch (error: any) {
                balanceRequestSentRef.current = false;

                updateDiagnostic({
                    lastError:
                        `Balance request : ${
                            error?.message ||
                            String(error)
                        }`,
                });
            }
        }, [updateDiagnostic]);

    const handleDerivMessage =
        useCallback(
            (message: any) => {
                if (!message) {
                    return;
                }

                const messageType =
                    String(
                        message.msg_type ??
                            message.echo_req?.msg_type ??
                            'unknown'
                    );

                setDiagnostic((previous) => ({
                    ...previous,
                    messagesReceived:
                        previous.messagesReceived + 1,
                    lastMessageType: messageType,
                }));

                if (
                    message.error
                ) {
                    const errorText =
                        message.error.message ||
                        message.error.code ||
                        'Erreur Deriv inconnue';

                    updateDiagnostic({
                        lastError:
                            `${messageType}: ${errorText}`,
                    });

                    setStatusMessage(
                        `🔴 Deriv : ${errorText}`
                    );

                    return;
                }

                if (
                    message.msg_type === 'tick' &&
                    message.tick
                ) {
                    handleTick(message.tick);
                    return;
                }

                if (
                    message.msg_type === 'balance' &&
                    message.balance
                ) {
                    const amount =
                        Number(
                            message.balance.balance
                        );

                    const currency =
                        String(
                            message.balance.currency ||
                                'USD'
                        );

                    const loginid =
                        String(
                            message.balance.loginid ||
                                ''
                        );

                    setBalanceInfo({
                        balance:
                            Number.isFinite(amount)
                                ? amount
                                : null,
                        currency,
                        loginid,
                    });

                    setConnected(true);

                    return;
                }

                if (
                    message.msg_type ===
                    'proposal'
                ) {
                    const proposalData =
                        message.proposal;

                    if (proposalData) {
                        setProposal({
                            status: 'success',
                            id: String(
                                proposalData.id ??
                                    ''
                            ),
                            contractType:
                                String(
                                    proposalData.contract_type ??
                                        ''
                                ),
                            payout:
                                Number(
                                    proposalData.payout
                                ),
                            askPrice:
                                Number(
                                    proposalData.ask_price
                                ),
                            message:
                                'Proposition reçue. Aucun achat effectué.',
                        });
                    }

                    return;
                }

                if (
                    message.msg_type ===
                    'authorize'
                ) {
                    const loginid =
                        String(
                            message.authorize
                                ?.loginid || ''
                        );

                    if (loginid) {
                        setBalanceInfo(
                            (previous) => ({
                                ...previous,
                                loginid,
                            })
                        );
                    }

                    return;
                }
            },
            [handleTick, updateDiagnostic]
        );

    const waitForApi = useCallback(
        async (
            timeoutMs = 12000
        ): Promise<boolean> => {
            const started =
                Date.now();

            while (
                mountedRef.current &&
                Date.now() - started <
                    timeoutMs
            ) {
                if (api_base.api) {
                    return true;
                }

                await new Promise<void>(
                    (resolve) =>
                        window.setTimeout(
                            resolve,
                            250
                        )
                );
            }

            return Boolean(
                api_base.api
            );
        },
        []
    );

    const initialiseApi =
        useCallback(async () => {
            if (api_base.api) {
                updateDiagnostic({
                    apiExists: true,
                    initFinished: true,
                });

                return true;
            }

            if (!initPromiseRef.current) {
                updateDiagnostic({
                    initStarted: true,
                });

                try {
                    initPromiseRef.current =
                        api_base.init();
                } catch (error: any) {
                    updateDiagnostic({
                        lastError:
                            `api_base.init() : ${
                                error?.message ||
                                String(error)
                            }`,
                    });
                }
            }

            /*
             * IMPORTANT :
             * On ne fait PAS un await illimité.
             *
             * Si init() reste bloqué, le diagnostic
             * continue quand même et vérifie si
             * api_base.api apparaît.
             */
            const apiReady =
                await waitForApi(12000);

            if (apiReady) {
                updateDiagnostic({
                    apiExists: true,
                    initFinished: true,
                });

                return true;
            }

            updateDiagnostic({
                apiExists: false,
                lastError:
                    'api_base.api reste null après 12 secondes.',
            });

            return false;
        }, [updateDiagnostic, waitForApi]);

    const attachDerivStream =
        useCallback(async () => {
            const ready =
                await initialiseApi();

            if (!ready || !api_base.api) {
                setConnected(false);

                setStatusMessage(
                    '🔴 API Deriv non disponible'
                );

                return;
            }

            updateDiagnostic({
                apiExists: true,
                apiKeys:
                    Object.keys(
                        api_base.api as any
                    ).join(', ') || 'prototype',
            });

            try {
                const stream =
                    api_base.api.onMessage();

                updateDiagnostic({
                    streamCreated: true,
                });

                const subscription =
                    stream.subscribe(
                        handleDerivMessage
                    );

                messageSubscriptionRef.current =
                    subscription;

                updateDiagnostic({
                    subscriptionCreated:
                        true,
                });

                setStatusMessage(
                    '🟠 Flux Deriv installé — demande des ticks…'
                );
            } catch (error: any) {
                updateDiagnostic({
                    lastError:
                        `onMessage() : ${
                            error?.message ||
                            String(error)
                        }`,
                });

                setStatusMessage(
                    '🔴 Impossible d’installer le flux Deriv'
                );

                return;
            }

            if (
                !tickRequestSentRef.current
            ) {
                try {
                    api_base.api.send({
                        ticks: MARKET_SYMBOL,
                        subscribe: 1,
                    });

                    tickRequestSentRef.current =
                        true;

                    updateDiagnostic({
                        tickRequestSent: true,
                    });

                    setStatusMessage(
                        '🟠 Abonnement EUR/USD envoyé — attente du premier tick…'
                    );
                } catch (error: any) {
                    updateDiagnostic({
                        lastError:
                            `Ticks : ${
                                error?.message ||
                                String(error)
                            }`,
                    });

                    setStatusMessage(
                        '🔴 Impossible de demander les ticks'
                    );
                }
            }

            requestCurrentBalance();
        }, [
            handleDerivMessage,
            initialiseApi,
            requestCurrentBalance,
            updateDiagnostic,
        ]);

    useEffect(() => {
        mountedRef.current = true;

        setStatusMessage(
            '🟠 Diagnostic V4.12.1 démarré…'
        );

        attachDerivStream();

        return () => {
            mountedRef.current = false;

            try {
                messageSubscriptionRef.current?.unsubscribe?.();
            } catch {}

            messageSubscriptionRef.current =
                null;
        };
    }, [attachDerivStream]);

    const startPaperTest =
        useCallback(() => {
            resetPaperStats();

            testModeRef.current = 'running';
            setTestMode('running');

            currentPredictionRef.current =
                prediction;

            setStatusMessage(
                '🟢 Test papier démarré — aucun trade réel'
            );
        }, [prediction, resetPaperStats]);

    const stopPaperTest =
        useCallback(() => {
            testModeRef.current = 'idle';
            setTestMode('idle');

            setStatusMessage(
                connected
                    ? '🟢 Connecté — test papier arrêté'
                    : '🟠 Test papier arrêté'
            );
        }, [connected]);

    const requestProposal =
        useCallback(() => {
            if (!api_base.api) {
                setProposal({
                    status: 'error',
                    message:
                        'API Deriv indisponible.',
                });

                return;
            }

            const contractType =
                getProposalContractType(
                    prediction
                );

            if (!contractType) {
                setProposal({
                    status: 'error',
                    message:
                        'Pas de direction suffisamment claire.',
                });

                return;
            }

            const loginid =
                balanceInfo.loginid;

            if (
                loginid &&
                !loginid.startsWith('VRTC') &&
                !loginid.startsWith('VR')
            ) {
                setProposal({
                    status: 'error',
                    message:
                        'Compte non reconnu comme compte virtuel.',
                });

                return;
            }

            setProposal({
                status: 'loading',
                contractType,
                message:
                    'Demande de proposition uniquement…',
            });

            try {
                api_base.api.send({
                    proposal: 1,
                    amount: 1,
                    basis: 'stake',
                    contract_type:
                        contractType,
                    currency:
                        balanceInfo.currency ||
                        'USD',
                    duration: 1,
                    duration_unit: 't',
                    symbol: MARKET_SYMBOL,
                });

                /*
                 * IMPORTANT :
                 * Aucun "buy" ici.
                 * Cette action demande seulement
                 * une proposition à Deriv.
                 */
            } catch (error: any) {
                setProposal({
                    status: 'error',
                    message:
                        error?.message ||
                        String(error),
                });
            }
        }, [
            balanceInfo.currency,
            balanceInfo.loginid,
            prediction,
        ]);

    const resetDiagnostic =
        useCallback(() => {
            setDiagnostic(
                EMPTY_DIAGNOSTIC
            );

            setStatusMessage(
                '🟠 Diagnostic réinitialisé…'
            );
        }, []);

    const stats =
        paperStats;

    const progress =
        Math.min(
            100,
            Math.round(
                (stats.total /
                    PAPER_TEST_LIMIT) *
                    100
            )
        );

    const currentBlock =
        Math.floor(
            stats.total / BLOCK_SIZE
        );

    const cardStyle: React.CSSProperties = {
        background: '#111827',
        border:
            '1px solid rgba(255,255,255,0.08)',
        borderRadius: 14,
        padding: 14,
        marginBottom: 12,
        boxSizing: 'border-box',
    };

    const valueStyle: React.CSSProperties = {
        fontSize: 22,
        fontWeight: 700,
        marginTop: 5,
    };

    const smallStyle: React.CSSProperties = {
        fontSize: 12,
        opacity: 0.72,
        marginTop: 4,
        wordBreak: 'break-word',
    };

    const diagnosticValue = (
        ok: boolean
    ) => (ok ? '🟢 OUI' : '🔴 NON');

    return (
        <div
            style={{
                width: '100%',
                height: '100dvh',
                minHeight: '100vh',
                overflowY: 'auto',
                overflowX: 'hidden',
                WebkitOverflowScrolling:
                    'touch',
                overscrollBehaviorY: 'auto',
                touchAction: 'pan-y',
                background: '#0f172a',
                color: '#e5e7eb',
                padding: 16,
                paddingBottom: 80,
                fontFamily:
                    'Arial, sans-serif',
                boxSizing: 'border-box',
            }}
        >
            <div
                style={{
                    maxWidth: 700,
                    margin: '0 auto',
                }}
            >
                <div
                    style={{
                        textAlign: 'center',
                        marginBottom: 16,
                    }}
                >
                    <h2
                        style={{
                            margin: 0,
                            fontSize: 21,
                        }}
                    >
                        📈 Moniteur Forex EUR/USD
                        — V4.12.1
                    </h2>

                    <div
                        style={{
                            fontSize: 13,
                            opacity: 0.7,
                            marginTop: 7,
                        }}
                    >
                        Diagnostic + Demo +
                        Paper Trader
                    </div>
                </div>

                <div
                    style={{
                        ...cardStyle,
                        border:
                            connected
                                ? '1px solid rgba(34,197,94,0.45)'
                                : '1px solid rgba(239,68,68,0.45)',
                    }}
                >
                    <div
                        style={{
                            fontWeight: 700,
                            marginBottom: 6,
                        }}
                    >
                        🔌 Connexion
                    </div>

                    <div
                        style={{
                            fontSize: 14,
                        }}
                    >
                        {statusMessage}
                    </div>

                    <div
                        style={smallStyle}
                    >
                        API :{' '}
                        {diagnosticValue(
                            diagnostic.apiExists
                        )}
                        {'  '} | Stream :{' '}
                        {diagnosticValue(
                            diagnostic.streamCreated
                        )}
                        {'  '} | Subscription :{' '}
                        {diagnosticValue(
                            diagnostic.subscriptionCreated
                        )}
                    </div>
                </div>

                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns:
                            '1fr 1fr',
                        gap: 10,
                    }}
                >
                    <div
                        style={cardStyle}
                    >
                        <div
                            style={smallStyle}
                        >
                            Prix {MARKET_NAME}
                        </div>

                        <div
                            style={valueStyle}
                        >
                            {price !== null
                                ? price.toFixed(5)
                                : '—'}
                        </div>
                    </div>

                    <div
                        style={cardStyle}
                    >
                        <div
                            style={smallStyle}
                        >
                            Dernier chiffre
                        </div>

                        <div
                            style={valueStyle}
                        >
                            {lastDigit !== null
                                ? lastDigit
                                : '—'}
                        </div>
                    </div>
                </div>

                <div
                    style={cardStyle}
                >
                    <div
                        style={smallStyle}
                    >
                        Direction actuelle
                    </div>

                    <div
                        style={valueStyle}
                    >
                        {getDirectionText(
                            direction
                        )}
                    </div>
                </div>

                <div
                    style={cardStyle}
                >
                    <div
                        style={smallStyle}
                    >
                        Prédiction
                    </div>

                    <div
                        style={valueStyle}
                    >
                        {getPredictionText(
                            prediction
                        )}
                    </div>

                    <div
                        style={smallStyle}
                    >
                        Force : {strength}%
                    </div>
                </div>

                <div
                    style={cardStyle}
                >
                    <div
                        style={{
                            fontWeight: 700,
                            marginBottom: 8,
                        }}
                    >
                        🧪 Test papier
                    </div>

                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns:
                                '1fr 1fr',
                            gap: 8,
                        }}
                    >
                        <div>
                            <div
                                style={
                                    smallStyle
                                }
                            >
                                Tests
                            </div>
                            <div
                                style={{
                                    fontSize: 20,
                                    fontWeight: 700,
                                }}
                            >
                                {stats.total}/
                                {PAPER_TEST_LIMIT}
                            </div>
                        </div>

                        <div>
                            <div
                                style={
                                    smallStyle
                                }
                            >
                                Taux
                            </div>
                            <div
                                style={{
                                    fontSize: 20,
                                    fontWeight: 700,
                                }}
                            >
                                {stats.rate.toFixed(
                                    2
                                )}
                                %
                            </div>
                        </div>

                        <div>
                            <div
                                style={
                                    smallStyle
                                }
                            >
                                🟢 Gains
                            </div>
                            <div
                                style={{
                                    fontSize: 20,
                                    fontWeight: 700,
                                }}
                            >
                                {stats.wins}
                            </div>
                        </div>

                        <div>
                            <div
                                style={
                                    smallStyle
                                }
                            >
                                🔴 Pertes
                            </div>
                            <div
                                style={{
                                    fontSize: 20,
                                    fontWeight: 700,
                                }}
                            >
                                {stats.losses}
                            </div>
                        </div>
                    </div>

                    <div
                        style={{
                            marginTop: 12,
                            padding: 10,
                            background: '#0f172a',
                            borderRadius: 10,
                        }}
                    >
                        <div
                            style={smallStyle}
                        >
                            P/L virtuel
                        </div>

                        <div
                            style={{
                                fontSize: 21,
                                fontWeight: 700,
                            }}
                        >
                            {stats.virtualPnL >=
                            0
                                ? '+'
                                : ''}
                            {stats.virtualPnL.toFixed(
                                0
                            )}
                        </div>
                    </div>

                    <div
                        style={{
                            marginTop: 10,
                            height: 8,
                            background: '#020617',
                            borderRadius: 99,
                            overflow: 'hidden',
                        }}
                    >
                        <div
                            style={{
                                width: `${progress}%`,
                                height: '100%',
                                background:
                                    '#22c55e',
                                transition:
                                    'width 0.2s',
                            }}
                        />
                    </div>

                    <div
                        style={smallStyle}
                    >
                        Bloc actuel :{' '}
                        {currentBlock}
                        {'  '}• Ticks reçus :{' '}
                        {historyCount}
                    </div>

                    <div
                        style={{
                            display: 'flex',
                            gap: 8,
                            marginTop: 12,
                            flexWrap: 'wrap',
                        }}
                    >
                        <button
                            onClick={
                                startPaperTest
                            }
                            style={{
                                flex: 1,
                                minWidth: 130,
                                padding: 12,
                                border: 0,
                                borderRadius: 10,
                                background:
                                    '#16a34a',
                                color: 'white',
                                fontWeight: 700,
                            }}
                        >
                            ▶️ Démarrer
                        </button>

                        <button
                            onClick={
                                stopPaperTest
                            }
                            style={{
                                flex: 1,
                                minWidth: 130,
                                padding: 12,
                                border: 0,
                                borderRadius: 10,
                                background:
                                    '#475569',
                                color: 'white',
                                fontWeight: 700,
                            }}
                        >
                            ⏹️ Arrêter
                        </button>
                    </div>

                    <div
                        style={smallStyle}
                    >
                        Mode :{' '}
                        {testMode ===
                        'running'
                            ? '🟢 EN COURS'
                            : testMode ===
                              'finished'
                            ? '🏁 TERMINÉ'
                            : '⚪ ARRÊTÉ'}
                    </div>
                </div>

                <div
                    style={cardStyle}
                >
                    <div
                        style={{
                            fontWeight: 700,
                            marginBottom: 8,
                        }}
                    >
                        💰 Compte démo
                    </div>

                    <div
                        style={{
                            fontSize: 24,
                            fontWeight: 700,
                        }}
                    >
                        {balanceInfo.balance !==
                        null
                            ? `${balanceInfo.balance.toFixed(
                                  2
                              )} ${
                                  balanceInfo.currency
                              }`
                            : '—'}
                    </div>

                    <div
                        style={smallStyle}
                    >
                        Login ID :{' '}
                        {balanceInfo.loginid ||
                            '—'}
                    </div>
                </div>

                <div
                    style={cardStyle}
                >
                    <div
                        style={{
                            fontWeight: 700,
                            marginBottom: 8,
                        }}
                    >
                        🧪 DIAGNOSTIC V4.12.1
                    </div>

                    <div
                        style={{
                            display: 'grid',
                            gap: 7,
                            fontSize: 13,
                        }}
                    >
                        <div>
                            API présente :{' '}
                            {diagnosticValue(
                                diagnostic.apiExists
                            )}
                        </div>

                        <div>
                            Init démarrée :{' '}
                            {diagnosticValue(
                                diagnostic.initStarted
                            )}
                        </div>

                        <div>
                            Init terminée :{' '}
                            {diagnosticValue(
                                diagnostic.initFinished
                            )}
                        </div>

                        <div>
                            onMessage créé :{' '}
                            {diagnosticValue(
                                diagnostic.streamCreated
                            )}
                        </div>

                        <div>
                            Subscription créée :{' '}
                            {diagnosticValue(
                                diagnostic.subscriptionCreated
                            )}
                        </div>

                        <div>
                            Demande ticks envoyée :{' '}
                            {diagnosticValue(
                                diagnostic.tickRequestSent
                            )}
                        </div>

                        <div>
                            Demande balance envoyée :{' '}
                            {diagnosticValue(
                                diagnostic.balanceRequestSent
                            )}
                        </div>

                        <div>
                            Messages reçus :{' '}
                            <strong>
                                {
                                    diagnostic.messagesReceived
                                }
                            </strong>
                        </div>

                        <div>
                            Ticks reçus :{' '}
                            <strong>
                                {
                                    diagnostic.ticksReceived
                                }
                            </strong>
                        </div>

                        <div>
                            Dernier type :{' '}
                            <strong>
                                {
                                    diagnostic.lastMessageType
                                }
                            </strong>
                        </div>

                        <div>
                            Dernier prix tick :{' '}
                            <strong>
                                {diagnostic.lastTickQuote !==
                                null
                                    ? diagnostic.lastTickQuote.toFixed(
                                          5
                                      )
                                    : '—'}
                            </strong>
                        </div>

                        <div>
                            Dernier epoch :{' '}
                            <strong>
                                {diagnostic.lastTickEpoch ??
                                    '—'}
                            </strong>
                        </div>
                    </div>

                    <div
                        style={{
                            marginTop: 12,
                            padding: 10,
                            borderRadius: 9,
                            background:
                                diagnostic.lastError
                                    ? 'rgba(239,68,68,0.12)'
                                    : 'rgba(34,197,94,0.08)',
                            border: diagnostic.lastError
                                ? '1px solid rgba(239,68,68,0.3)'
                                : '1px solid rgba(34,197,94,0.2)',
                            fontSize: 12,
                            wordBreak:
                                'break-word',
                        }}
                    >
                        <strong>
                            Dernière erreur :
                        </strong>{' '}
                        {diagnostic.lastError ||
                            'Aucune'}
                    </div>

                    <div
                        style={smallStyle}
                    >
                        API keys détectées :{' '}
                        {diagnostic.apiKeys}
                    </div>

                    <button
                        onClick={
                            resetDiagnostic
                        }
                        style={{
                            width: '100%',
                            marginTop: 12,
                            padding: 11,
                            border: 0,
                            borderRadius: 10,
                            background:
                                '#334155',
                            color: 'white',
                            fontWeight: 700,
                        }}
                    >
                        🔄 Réinitialiser diagnostic
                    </button>
                </div>

                <div
                    style={cardStyle}
                >
                    <div
                        style={{
                            fontWeight: 700,
                            marginBottom: 8,
                        }}
                    >
                        🧾 Proposition Demo
                    </div>

                    <div
                        style={smallStyle}
                    >
                        Direction actuelle :{' '}
                        {getPredictionText(
                            prediction
                        )}
                    </div>

                    <button
                        onClick={
                            requestProposal
                        }
                        disabled={
                            proposal.status ===
                            'loading'
                        }
                        style={{
                            width: '100%',
                            marginTop: 10,
                            padding: 12,
                            border: 0,
                            borderRadius: 10,
                            background:
                                '#2563eb',
                            color: 'white',
                            fontWeight: 700,
                            opacity:
                                proposal.status ===
                                'loading'
                                    ? 0.6
                                    : 1,
                        }}
                    >
                        {proposal.status ===
                        'loading'
                            ? '⏳ Demande…'
                            : '🔎 Demander une proposition'}
                    </button>

                    {proposal.message && (
                        <div
                            style={{
                                marginTop: 10,
                                padding: 10,
                                borderRadius: 9,
                                background:
                                    '#0f172a',
                                fontSize: 13,
                                wordBreak:
                                    'break-word',
                            }}
                        >
                            {proposal.message}
                        </div>
                    )}

                    {proposal.status ===
                        'success' && (
                        <div
                            style={{
                                marginTop: 10,
                                fontSize: 13,
                                lineHeight: 1.6,
                            }}
                        >
                            <div>
                                Contrat :{' '}
                                {proposal.contractType ||
                                    '—'}
                            </div>

                            <div>
                                Prix demandé :{' '}
                                {Number.isFinite(
                                    proposal.askPrice
                                )
                                    ? proposal.askPrice
                                    : '—'}
                            </div>

                            <div>
                                Payout :{' '}
                                {Number.isFinite(
                                    proposal.payout
                                )
                                    ? proposal.payout
                                    : '—'}
                            </div>

                            <div
                                style={{
                                    marginTop: 6,
                                    fontWeight: 700,
                                }}
                            >
                                🚫 Aucun achat
                                effectué.
                            </div>
                        </div>
                    )}
                </div>

                <div
                    style={{
                        textAlign: 'center',
                        opacity: 0.55,
                        fontSize: 11,
                        marginTop: 20,
                    }}
                >
                    V4.12.1 Diagnostic •{' '}
                    {MARKET_SYMBOL}
                    <br />
                    Paper test uniquement •
                    Aucun BUY/SELL
                </div>
            </div>
        </div>
    );
}

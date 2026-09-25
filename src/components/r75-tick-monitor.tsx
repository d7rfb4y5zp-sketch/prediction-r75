import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api_base } from '../external/bot-skeleton/services/api/api-base';

const MARKET_SYMBOL = 'frxEURUSD';
const MARKET_NAME = 'EUR/USD';

const HISTORY_SIZE = 500;
const PAPER_TEST_LIMIT = 1000;
const BLOCK_SIZE = 100;
const ANALYSIS_WINDOW = 20;

type Direction = 'UP' | 'DOWN' | 'FLAT';
type TestMode = 'idle' | 'running' | 'finished';

type Tick = {
    quote: number;
    epoch: number;
};

type Stats = {
    total: number;
    wins: number;
    losses: number;
    rate: number;
    profit: number;
};

type BalanceInfo = {
    balance: number;
    currency?: string;
    loginid?: string;
};

type ProposalInfo = {
    id?: string;
    ask_price?: number;
    payout?: number;
    display_value?: string;
    contract_type?: string;
    duration?: number;
    duration_unit?: string;
};

const getLastDigit = (quote: number): number => {
    const text = quote.toFixed(5);
    const digits = text.replace(/\D/g, '');

    if (!digits.length) return 0;

    return Number(digits.slice(-1));
};

const calculateDirection = (
    previous: number | null,
    current: number
): Direction => {
    if (previous === null) return 'FLAT';

    if (current > previous) return 'UP';
    if (current < previous) return 'DOWN';

    return 'FLAT';
};

const calculatePrediction = (
    ticks: Tick[]
): { prediction: Direction; strength: number } => {
    if (ticks.length < 5) {
        return {
            prediction: 'FLAT',
            strength: 0,
        };
    }

    const sample = ticks.slice(-ANALYSIS_WINDOW);

    let up = 0;
    let down = 0;
    let flat = 0;

    for (let i = 1; i < sample.length; i += 1) {
        const direction = calculateDirection(
            sample[i - 1].quote,
            sample[i].quote
        );

        if (direction === 'UP') up += 1;
        else if (direction === 'DOWN') down += 1;
        else flat += 1;
    }

    const total = up + down + flat;

    if (!total) {
        return {
            prediction: 'FLAT',
            strength: 0,
        };
    }

    if (up > down && up >= flat) {
        return {
            prediction: 'UP',
            strength: Math.round((up / total) * 100),
        };
    }

    if (down > up && down >= flat) {
        return {
            prediction: 'DOWN',
            strength: Math.round((down / total) * 100),
        };
    }

    return {
        prediction: 'FLAT',
        strength: Math.round((flat / total) * 100),
    };
};

const getPredictionText = (prediction: Direction) => {
    if (prediction === 'UP') return '🟢 HAUSSE';
    if (prediction === 'DOWN') return '🔴 BAISSE';
    return '⚪ STABLE';
};

const getProposalContractType = (prediction: Direction) => {
    if (prediction === 'UP') return 'CALL';
    if (prediction === 'DOWN') return 'PUT';

    return null;
};

const emptyStats = (): Stats => ({
    total: 0,
    wins: 0,
    losses: 0,
    rate: 0,
    profit: 0,
});

const R75TickMonitor: React.FC = () => {
    const [connected, setConnected] = useState(false);

    const [price, setPrice] = useState<number | null>(null);
    const [lastDigit, setLastDigit] = useState<number | null>(null);

    const [ticks, setTicks] = useState<Tick[]>([]);
    const [direction, setDirection] = useState<Direction>('FLAT');
    const [prediction, setPrediction] = useState<Direction>('FLAT');
    const [strength, setStrength] = useState(0);

    const [observations, setObservations] = useState(0);

    const [balance, setBalance] = useState<BalanceInfo | null>(null);
    const [balanceStatus, setBalanceStatus] = useState('—');

    const [testMode, setTestMode] = useState<TestMode>('idle');
    const [paperStats, setPaperStats] = useState<Stats>(emptyStats());

    const [blockResults, setBlockResults] = useState<Stats[]>([]);
    const [finalPrediction, setFinalPrediction] =
        useState<Direction>('FLAT');

    const [statusMessage, setStatusMessage] =
        useState('Initialisation…');

    const [amount, setAmount] = useState('1');

    const [proposal, setProposal] =
        useState<ProposalInfo | null>(null);

    const [proposalLoading, setProposalLoading] =
        useState(false);

    const [proposalMessage, setProposalMessage] =
        useState('');

    const [proposalError, setProposalError] =
        useState('');

    const [accountIsDemo, setAccountIsDemo] =
        useState(false);

    const previousPriceRef = useRef<number | null>(null);

    const currentPredictionRef =
        useRef<Direction>('FLAT');

    const testModeRef =
        useRef<TestMode>('idle');

    const paperStatsRef =
        useRef<Stats>(emptyStats());

    const blockResultsRef =
        useRef<Stats[]>([]);

    const blockWinsRef =
        useRef(0);

    const blockLossesRef =
        useRef(0);

    const blockProfitRef =
        useRef(0);

    const balanceRequestIdRef =
        useRef(4900);

    const proposalRequestIdRef =
        useRef(12000);

    const mountedRef =
        useRef(true);

    const messageSubscriptionRef =
        useRef<{ unsubscribe?: () => void } | null>(null);

    const resetBlockCounters = useCallback(() => {
        blockWinsRef.current = 0;
        blockLossesRef.current = 0;
        blockProfitRef.current = 0;
    }, []);

    const resetPaperStats = useCallback(() => {
        const stats = emptyStats();

        paperStatsRef.current = stats;

        setPaperStats(stats);
        setBlockResults([]);
        blockResultsRef.current = [];

        resetBlockCounters();

        setFinalPrediction('FLAT');
    }, [resetBlockCounters]);

    const processPaperObservation = useCallback(
        (currentDirection: Direction) => {
            if (testModeRef.current !== 'running') {
                return;
            }

            const previousPrediction =
                currentPredictionRef.current;

            if (previousPrediction === 'FLAT') {
                return;
            }

            const win =
                previousPrediction === currentDirection;

            const oldStats =
                paperStatsRef.current;

            const newStats: Stats = {
                total: oldStats.total + 1,
                wins: oldStats.wins + (win ? 1 : 0),
                losses: oldStats.losses + (win ? 0 : 1),
                rate: 0,
                profit:
                    oldStats.profit +
                    (win ? 1 : -1),
            };

            newStats.rate =
                newStats.total > 0
                    ? (newStats.wins / newStats.total) * 100
                    : 0;

            paperStatsRef.current = newStats;

            if (!mountedRef.current) return;

            setPaperStats(newStats);

            if (win) {
                blockWinsRef.current += 1;
            } else {
                blockLossesRef.current += 1;
            }

            blockProfitRef.current +=
                win ? 1 : -1;

            if (
                newStats.total > 0 &&
                newStats.total % BLOCK_SIZE === 0
            ) {
                const block: Stats = {
                    total: BLOCK_SIZE,
                    wins: blockWinsRef.current,
                    losses: blockLossesRef.current,
                    rate:
                        (blockWinsRef.current /
                            BLOCK_SIZE) *
                        100,
                    profit: blockProfitRef.current,
                };

                const updatedBlocks = [
                    ...blockResultsRef.current,
                    block,
                ];

                blockResultsRef.current =
                    updatedBlocks;

                setBlockResults(updatedBlocks);

                resetBlockCounters();
            }

            if (
                newStats.total >=
                PAPER_TEST_LIMIT
            ) {
                testModeRef.current = 'finished';

                setTestMode('finished');

                setFinalPrediction(
                    currentPredictionRef.current
                );

                setStatusMessage(
                    '✅ Paper Test terminé — 1000 observations'
                );
            }
        },
        [resetBlockCounters]
    );

    const processTick = useCallback(
        (tick: Tick) => {
            if (!Number.isFinite(tick.quote)) {
                return;
            }

            const previousPrice =
                previousPriceRef.current;

            const currentDirection =
                calculateDirection(
                    previousPrice,
                    tick.quote
                );

            /*
             * Validation de la prédiction précédente
             * AVANT de remplacer currentPredictionRef.
             */
            processPaperObservation(
                currentDirection
            );

            previousPriceRef.current =
                tick.quote;

            setPrice(tick.quote);

            setLastDigit(
                getLastDigit(tick.quote)
            );

            setDirection(
                currentDirection
            );

            setTicks(previousTicks => {
                const nextTicks = [
                    ...previousTicks,
                    tick,
                ].slice(-HISTORY_SIZE);

                const analysis =
                    calculatePrediction(
                        nextTicks
                    );

                currentPredictionRef.current =
                    analysis.prediction;

                if (mountedRef.current) {
                    setPrediction(
                        analysis.prediction
                    );

                    setStrength(
                        analysis.strength
                    );
                }

                return nextTicks;
            });

            setObservations(
                value => value + 1
            );
        },
        [processPaperObservation]
    );

    const handleDerivMessage = useCallback(
        (message: any) => {
            if (!message) return;

            if (message.error) {
                const errorMessage =
                    message.error.message ||
                    message.error.code ||
                    'Erreur Deriv';

                if (mountedRef.current) {
                    setStatusMessage(
                        `🔴 ${errorMessage}`
                    );
                }

                return;
            }

            if (message.msg_type === 'tick') {
                const tick = message.tick;

                if (!tick) return;

                processTick({
                    quote: Number(tick.quote),
                    epoch: Number(
                        tick.epoch || Date.now() / 1000
                    ),
                });

                if (mountedRef.current) {
                    setConnected(true);
                    setStatusMessage(
                        '🟢 Connecté à Deriv — ticks reçus'
                    );
                }

                return;
            }

            if (message.msg_type === 'balance') {
                const balanceValue =
                    Number(message.balance);

                const loginid =
                    message.loginid ||
                    message.authorize?.loginid;

                const currency =
                    message.currency ||
                    message.authorize?.currency ||
                    'USD';

                const info: BalanceInfo = {
                    balance: balanceValue,
                    currency,
                    loginid,
                };

                if (mountedRef.current) {
                    setBalance(info);
                    setBalanceStatus('🟢 Solde reçu');
                    setConnected(true);

                    /*
                     * Sécurité :
                     * le compte doit être clairement Demo.
                     */
                    const isDemo =
                        typeof loginid === 'string' &&
                        (
                            loginid.startsWith('VRTC') ||
                            loginid.startsWith('VR')
                        );

                    setAccountIsDemo(isDemo);
                }

                return;
            }

            if (message.msg_type === 'authorize') {
                const loginid =
                    message.authorize?.loginid ||
                    message.loginid;

                const currency =
                    message.authorize?.currency ||
                    'USD';

                const isDemo =
                    typeof loginid === 'string' &&
                    (
                        loginid.startsWith('VRTC') ||
                        loginid.startsWith('VR')
                    );

                if (mountedRef.current) {
                    setAccountIsDemo(isDemo);
                    setConnected(true);
                }

                if (
                    message.authorize?.balance !==
                    undefined
                ) {
                    const info: BalanceInfo = {
                        balance: Number(
                            message.authorize.balance
                        ),
                        currency,
                        loginid,
                    };

                    if (mountedRef.current) {
                        setBalance(info);
                        setBalanceStatus(
                            '🟢 Solde reçu'
                        );
                    }
                }

                return;
            }

            if (
                message.msg_type === 'proposal'
            ) {
                const proposalData =
                    message.proposal;

                if (!proposalData) return;

                const proposalInfo: ProposalInfo = {
                    id: proposalData.id,
                    ask_price:
                        Number(
                            proposalData.ask_price
                        ),
                    payout:
                        Number(
                            proposalData.payout
                        ),
                    display_value:
                        proposalData.display_value,
                    contract_type:
                        proposalData.contract_type,
                    duration:
                        Number(
                            proposalData.duration
                        ),
                    duration_unit:
                        proposalData.duration_unit,
                };

                if (mountedRef.current) {
                    setProposal(
                        proposalInfo
                    );

                    setProposalLoading(
                        false
                    );

                    setProposalError('');

                    setProposalMessage(
                        '✅ Proposition Demo reçue — aucun achat effectué.'
                    );
                }

                return;
            }

            /*
             * Certaines réponses peuvent être envoyées
             * avec req_id sans msg_type utile.
             */
            if (
                message.req_id &&
                message.error
            ) {
                if (mountedRef.current) {
                    setProposalLoading(
                        false
                    );

                    setProposalError(
                        message.error.message ||
                        'Erreur de requête'
                    );
                }
            }
        },
        [processTick]
    );

    const requestCurrentBalance =
        useCallback(() => {
            if (!api_base.api) {
                setBalanceStatus(
                    '🔴 API Deriv non initialisée'
                );

                return;
            }

            const requestId =
                balanceRequestIdRef.current + 1;

            balanceRequestIdRef.current =
                requestId;

            setBalanceStatus(
                '🟠 Chargement du solde…'
            );

            try {
                api_base.api.send({
                    balance: 1,
                    req_id: requestId,
                });
            } catch (error) {
                setBalanceStatus(
                    '🔴 Erreur balance'
                );
            }
        }, []);

    const requestDemoProposal =
        useCallback(() => {
            setProposalError('');
            setProposalMessage('');
            setProposal(null);

            if (!api_base.api) {
                setProposalError(
                    'API Deriv non initialisée.'
                );

                return;
            }

            if (!accountIsDemo) {
                setProposalError(
                    '⚠️ Aucun compte Demo clairement détecté. Aucune proposition envoyée.'
                );

                return;
            }

            const numericAmount =
                Number(amount);

            if (
                !Number.isFinite(
                    numericAmount
                ) ||
                numericAmount <= 0
            ) {
                setProposalError(
                    'Montant invalide.'
                );

                return;
            }

            const contractType =
                getProposalContractType(
                    prediction
                );

            if (!contractType) {
                setProposalError(
                    'Pas de signal UP/DOWN suffisamment défini.'
                );

                return;
            }

            const requestId =
                proposalRequestIdRef.current + 1;

            proposalRequestIdRef.current =
                requestId;

            setProposalLoading(true);

            setProposalMessage(
                '🟠 Demande de proposition Demo…'
            );

            try {
                /*
                 * IMPORTANT :
                 * proposal uniquement.
                 *
                 * Il n'y a volontairement AUCUN buy ici.
                 */
                api_base.api.send({
                    proposal: 1,
                    amount: numericAmount,
                    basis: 'stake',
                    contract_type:
                        contractType,
                    currency:
                        balance?.currency ||
                        'USD',
                    duration: 1,
                    duration_unit: 'm',
                    underlying_symbol:
                        MARKET_SYMBOL,
                    req_id: requestId,
                });
            } catch (error) {
                setProposalLoading(false);

                setProposalError(
                    'Impossible d’envoyer la demande de proposition.'
                );
            }
        }, [
            accountIsDemo,
            amount,
            balance?.currency,
            prediction,
        ]);

    const startPaperTest = useCallback(() => {
        resetPaperStats();

        testModeRef.current =
            'running';

        setTestMode('running');

        setStatusMessage(
            `🟠 Paper Test démarré — objectif ${PAPER_TEST_LIMIT} observations`
        );
    }, [resetPaperStats]);

    const stopPaperTest = useCallback(() => {
        testModeRef.current =
            'idle';

        setTestMode('idle');

        setStatusMessage(
            '⏹️ Paper Test arrêté'
        );
    }, []);

    const resetAllPaper = useCallback(() => {
        testModeRef.current =
            'idle';

        setTestMode('idle');

        resetPaperStats();

        setStatusMessage(
            '🔄 Statistiques Paper réinitialisées'
        );
    }, [resetPaperStats]);

    /*
     * Connexion Deriv
     */
    useEffect(() => {
        mountedRef.current = true;

        let cancelled = false;

        const connect = async () => {
            try {
                if (mountedRef.current) {
                    setStatusMessage(
                        '🟠 Initialisation de Deriv…'
                    );
                }

                /*
                 * IMPORTANT :
                 * api_base.init() doit être appelé
                 * avant d'utiliser api_base.api.
                 */
                await api_base.init();

                if (
                    cancelled ||
                    !mountedRef.current
                ) {
                    return;
                }

                if (!api_base.api) {
                    setStatusMessage(
                        '🔴 API Deriv indisponible'
                    );

                    return;
                }

                /*
                 * L'API interne utilise :
                 * api.onMessage().subscribe(...)
                 *
                 * et NON :
                 * api.onMessage(callback)
                 */
                const stream =
                    api_base.api.onMessage();

                const subscription =
                    stream.subscribe(
                        handleDerivMessage
                    );

                messageSubscriptionRef.current =
                    subscription;

                setStatusMessage(
                    '🟠 Connexion à Deriv…'
                );

                /*
                 * Souscription aux ticks EUR/USD.
                 */
                try {
                    api_base.api.send({
                        ticks: MARKET_SYMBOL,
                        subscribe: 1,
                    });
                } catch (error) {
                    setStatusMessage(
                        '🔴 Impossible de demander les ticks'
                    );
                }

                /*
                 * Solde ponctuel.
                 *
                 * Aucun subscribe balance ici,
                 * pour éviter les doublons.
                 */
                requestCurrentBalance();
            } catch (error: any) {
                if (
                    cancelled ||
                    !mountedRef.current
                ) {
                    return;
                }

                setConnected(false);

                setStatusMessage(
                    `🔴 Connexion Deriv impossible${
                        error?.message
                            ? ` — ${error.message}`
                            : ''
                    }`
                );
            }
        };

        connect();

        return () => {
            cancelled = true;
            mountedRef.current = false;

            try {
                messageSubscriptionRef.current?.unsubscribe?.();
            } catch (error) {
                // Rien à faire
            }

            messageSubscriptionRef.current =
                null;
        };
    }, [
        handleDerivMessage,
        requestCurrentBalance,
    ]);

    const averageBlockRate = useMemo(() => {
        if (!blockResults.length) {
            return null;
        }

        const totalWins =
            blockResults.reduce(
                (sum, block) =>
                    sum + block.wins,
                0
            );

        const total =
            blockResults.reduce(
                (sum, block) =>
                    sum + block.total,
                0
            );

        if (!total) return null;

        return (
            (totalWins / total) * 100
        );
    }, [blockResults]);

    const displayBalance =
        balance
            ? `${balance.balance.toFixed(2)} ${
                  balance.currency || 'USD'
              }`
            : '—';

    const displayPrice =
        price !== null
            ? price.toFixed(5)
            : '—';

    const displayRate =
        paperStats.total > 0
            ? `${paperStats.rate.toFixed(2)} %`
            : '—';

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
                padding: '16px',
                paddingBottom: '70px',
                fontFamily:
                    'Arial, sans-serif',
                boxSizing: 'border-box',
            }}
        >
            <div
                style={{
                    maxWidth: 900,
                    margin: '0 auto',
                }}
            >
                <div
                    style={{
                        background:
                            '#111827',
                        border:
                            '1px solid #243244',
                        borderRadius: 18,
                        padding: 18,
                        marginBottom: 14,
                    }}
                >
                    <div
                        style={{
                            fontSize: 24,
                            fontWeight: 800,
                        }}
                    >
                        📈 Moniteur Forex
                        EUR/USD — V4.12
                    </div>

                    <div
                        style={{
                            marginTop: 6,
                            color: '#94a3b8',
                            fontSize: 14,
                        }}
                    >
                        Demo + Paper Trader +
                        Proposition
                    </div>

                    <div
                        style={{
                            marginTop: 14,
                            padding: 12,
                            borderRadius: 12,
                            background:
                                connected
                                    ? '#052e1b'
                                    : '#3f1d1d',
                            color:
                                connected
                                    ? '#86efac'
                                    : '#fca5a5',
                            fontWeight: 700,
                        }}
                    >
                        {connected
                            ? '🟢 Connexion Deriv active'
                            : '🔌 Connexion'}
                    </div>

                    <div
                        style={{
                            marginTop: 8,
                            color: '#94a3b8',
                            fontSize: 13,
                        }}
                    >
                        {statusMessage}
                    </div>
                </div>

                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns:
                            'repeat(auto-fit,minmax(150px,1fr))',
                        gap: 10,
                        marginBottom: 14,
                    }}
                >
                    <div
                        style={{
                            background:
                                '#111827',
                            border:
                                '1px solid #243244',
                            borderRadius: 16,
                            padding: 15,
                        }}
                    >
                        <div
                            style={{
                                color: '#94a3b8',
                                fontSize: 13,
                            }}
                        >
                            Prix EUR/USD
                        </div>

                        <div
                            style={{
                                fontSize: 25,
                                fontWeight: 800,
                                marginTop: 6,
                            }}
                        >
                            {displayPrice}
                        </div>
                    </div>

                    <div
                        style={{
                            background:
                                '#111827',
                            border:
                                '1px solid #243244',
                            borderRadius: 16,
                            padding: 15,
                        }}
                    >
                        <div
                            style={{
                                color: '#94a3b8',
                                fontSize: 13,
                            }}
                        >
                            Dernier chiffre
                        </div>

                        <div
                            style={{
                                fontSize: 32,
                                fontWeight: 900,
                                marginTop: 3,
                            }}
                        >
                            {lastDigit ??
                                '—'}
                        </div>
                    </div>

                    <div
                        style={{
                            background:
                                '#111827',
                            border:
                                '1px solid #243244',
                            borderRadius: 16,
                            padding: 15,
                        }}
                    >
                        <div
                            style={{
                                color: '#94a3b8',
                                fontSize: 13,
                            }}
                        >
                            Direction actuelle
                        </div>

                        <div
                            style={{
                                fontSize: 20,
                                fontWeight: 800,
                                marginTop: 6,
                            }}
                        >
                            {getPredictionText(
                                direction
                            )}
                        </div>
                    </div>

                    <div
                        style={{
                            background:
                                '#111827',
                            border:
                                '1px solid #243244',
                            borderRadius: 16,
                            padding: 15,
                        }}
                    >
                        <div
                            style={{
                                color: '#94a3b8',
                                fontSize: 13,
                            }}
                        >
                            Prédiction
                        </div>

                        <div
                            style={{
                                fontSize: 20,
                                fontWeight: 800,
                                marginTop: 6,
                            }}
                        >
                            {getPredictionText(
                                prediction
                            )}
                        </div>

                        <div
                            style={{
                                color: '#94a3b8',
                                fontSize: 12,
                                marginTop: 4,
                            }}
                        >
                            Force : {strength}%
                        </div>
                    </div>
                </div>

                <div
                    style={{
                        background:
                            '#111827',
                        border:
                            '1px solid #243244',
                        borderRadius: 18,
                        padding: 18,
                        marginBottom: 14,
                    }}
                >
                    <div
                        style={{
                            fontSize: 18,
                            fontWeight: 800,
                            marginBottom: 12,
                        }}
                    >
                        💰 Compte Demo
                    </div>

                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns:
                                'repeat(auto-fit,minmax(150px,1fr))',
                            gap: 10,
                        }}
                    >
                        <div
                            style={{
                                background:
                                    '#0f172a',
                                borderRadius: 12,
                                padding: 12,
                            }}
                        >
                            <div
                                style={{
                                    color: '#94a3b8',
                                    fontSize: 12,
                                }}
                            >
                                Solde
                            </div>

                            <div
                                style={{
                                    fontSize: 20,
                                    fontWeight: 800,
                                    marginTop: 5,
                                }}
                            >
                                {displayBalance}
                            </div>
                        </div>

                        <div
                            style={{
                                background:
                                    '#0f172a',
                                borderRadius: 12,
                                padding: 12,
                            }}
                        >
                            <div
                                style={{
                                    color: '#94a3b8',
                                    fontSize: 12,
                                }}
                            >
                                Compte
                            </div>

                            <div
                                style={{
                                    fontSize: 15,
                                    fontWeight: 700,
                                    marginTop: 5,
                                    wordBreak:
                                        'break-word',
                                }}
                            >
                                {balance?.loginid ||
                                    '—'}
                            </div>
                        </div>

                        <div
                            style={{
                                background:
                                    '#0f172a',
                                borderRadius: 12,
                                padding: 12,
                            }}
                        >
                            <div
                                style={{
                                    color: '#94a3b8',
                                    fontSize: 12,
                                }}
                            >
                                Statut solde
                            </div>

                            <div
                                style={{
                                    marginTop: 5,
                                    fontWeight: 700,
                                }}
                            >
                                {balanceStatus}
                            </div>
                        </div>
                    </div>
                </div>

                <div
                    style={{
                        background:
                            '#111827',
                        border:
                            '1px solid #243244',
                        borderRadius: 18,
                        padding: 18,
                        marginBottom: 14,
                    }}
                >
                    <div
                        style={{
                            fontSize: 18,
                            fontWeight: 800,
                        }}
                    >
                        🧪 Paper Test
                    </div>

                    <div
                        style={{
                            color: '#94a3b8',
                            fontSize: 13,
                            marginTop: 5,
                            marginBottom: 14,
                        }}
                    >
                        Test virtuel uniquement.
                        Aucun ordre n'est envoyé.
                    </div>

                    <div
                        style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 8,
                            marginBottom: 15,
                        }}
                    >
                        <button
                            type="button"
                            onClick={
                                startPaperTest
                            }
                            disabled={
                                testMode ===
                                'running'
                            }
                            style={{
                                border: 0,
                                borderRadius: 10,
                                padding:
                                    '11px 14px',
                                background:
                                    testMode ===
                                    'running'
                                        ? '#374151'
                                        : '#16a34a',
                                color: 'white',
                                fontWeight: 800,
                            }}
                        >
                            ▶️ DÉMARRER
                        </button>

                        <button
                            type="button"
                            onClick={
                                stopPaperTest
                            }
                            disabled={
                                testMode !==
                                'running'
                            }
                            style={{
                                border: 0,
                                borderRadius: 10,
                                padding:
                                    '11px 14px',
                                background:
                                    '#dc2626',
                                color: 'white',
                                fontWeight: 800,
                                opacity:
                                    testMode !==
                                    'running'
                                        ? 0.5
                                        : 1,
                            }}
                        >
                            ⏹️ ARRÊTER
                        </button>

                        <button
                            type="button"
                            onClick={
                                resetAllPaper
                            }
                            style={{
                                border: 0,
                                borderRadius: 10,
                                padding:
                                    '11px 14px',
                                background:
                                    '#475569',
                                color: 'white',
                                fontWeight: 800,
                            }}
                        >
                            🔄 RESET
                        </button>
                    </div>

                    <div
                        style={{
                            background:
                                '#0f172a',
                            borderRadius: 12,
                            padding: 12,
                            marginBottom: 12,
                        }}
                    >
                        <div
                            style={{
                                fontWeight: 800,
                            }}
                        >
                            État :{' '}
                            {testMode ===
                            'running'
                                ? '🟠 EN COURS'
                                : testMode ===
                                  'finished'
                                ? '✅ TERMINÉ'
                                : '⚪ ARRÊTÉ'}
                        </div>

                        <div
                            style={{
                                color: '#94a3b8',
                                marginTop: 4,
                                fontSize: 13,
                            }}
                        >
                            {paperStats.total} /{' '}
                            {PAPER_TEST_LIMIT}{' '}
                            observations
                        </div>
                    </div>

                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns:
                                'repeat(auto-fit,minmax(120px,1fr))',
                            gap: 8,
                        }}
                    >
                        <div
                            style={{
                                background:
                                    '#0f172a',
                                padding: 12,
                                borderRadius: 12,
                            }}
                        >
                            <div
                                style={{
                                    color: '#94a3b8',
                                    fontSize: 12,
                                }}
                            >
                                WIN
                            </div>
                            <div
                                style={{
                                    fontSize: 23,
                                    fontWeight: 900,
                                }}
                            >
                                {paperStats.wins}
                            </div>
                        </div>

                        <div
                            style={{
                                background:
                                    '#0f172a',
                                padding: 12,
                                borderRadius: 12,
                            }}
                        >
                            <div
                                style={{
                                    color: '#94a3b8',
                                    fontSize: 12,
                                }}
                            >
                                LOSS
                            </div>
                            <div
                                style={{
                                    fontSize: 23,
                                    fontWeight: 900,
                                }}
                            >
                                {paperStats.losses}
                            </div>
                        </div>

                        <div
                            style={{
                                background:
                                    '#0f172a',
                                padding: 12,
                                borderRadius: 12,
                            }}
                        >
                            <div
                                style={{
                                    color: '#94a3b8',
                                    fontSize: 12,
                                }}
                            >
                                Taux
                            </div>
                            <div
                                style={{
                                    fontSize: 23,
                                    fontWeight: 900,
                                }}
                            >
                                {displayRate}
                            </div>
                        </div>

                        <div
                            style={{
                                background:
                                    '#0f172a',
                                padding: 12,
                                borderRadius: 12,
                            }}
                        >
                            <div
                                style={{
                                    color: '#94a3b8',
                                    fontSize: 12,
                                }}
                            >
                                P/L virtuel
                            </div>
                            <div
                                style={{
                                    fontSize: 23,
                                    fontWeight: 900,
                                }}
                            >
                                {paperStats.profit >=
                                0
                                    ? '+'
                                    : ''}
                                {
                                    paperStats.profit
                                }
                            </div>
                        </div>
                    </div>

                    <div
                        style={{
                            marginTop: 12,
                            color: '#94a3b8',
                            fontSize: 13,
                        }}
                    >
                        Blocs terminés :{' '}
                        {blockResults.length}
                        {averageBlockRate !==
                            null &&
                            ` — moyenne : ${averageBlockRate.toFixed(
                                2
                            )}%`}
                    </div>
                </div>

                <div
                    style={{
                        background:
                            '#111827',
                        border:
                            '1px solid #243244',
                        borderRadius: 18,
                        padding: 18,
                        marginBottom: 14,
                    }}
                >
                    <div
                        style={{
                            fontSize: 18,
                            fontWeight: 800,
                        }}
                    >
                        💵 Proposition Demo
                    </div>

                    <div
                        style={{
                            color: '#94a3b8',
                            fontSize: 13,
                            marginTop: 5,
                        }}
                    >
                        Cette section demande
                        uniquement une proposition.
                        Aucun achat n'est effectué.
                    </div>

                    <div
                        style={{
                            marginTop: 14,
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 8,
                            alignItems: 'center',
                        }}
                    >
                        <input
                            value={amount}
                            onChange={event =>
                                setAmount(
                                    event.target
                                        .value
                                )
                            }
                            type="number"
                            min="0.35"
                            step="0.01"
                            inputMode="decimal"
                            style={{
                                width: 100,
                                padding: 11,
                                borderRadius: 10,
                                border:
                                    '1px solid #475569',
                                background:
                                    '#0f172a',
                                color: 'white',
                                fontSize: 16,
                                boxSizing:
                                    'border-box',
                            }}
                        />

                        <button
                            type="button"
                            onClick={
                                requestDemoProposal
                            }
                            disabled={
                                proposalLoading
                            }
                            style={{
                                border: 0,
                                borderRadius: 10,
                                padding:
                                    '12px 14px',
                                background:
                                    '#2563eb',
                                color: 'white',
                                fontWeight: 800,
                                opacity:
                                    proposalLoading
                                        ? 0.6
                                        : 1,
                            }}
                        >
                            {proposalLoading
                                ? '🟠 DEMANDE…'
                                : '💵 OBTENIR PROPOSITION DEMO'}
                        </button>
                    </div>

                    <div
                        style={{
                            marginTop: 12,
                            padding: 12,
                            borderRadius: 12,
                            background:
                                accountIsDemo
                                    ? '#052e1b'
                                    : '#3f1d1d',
                            color:
                                accountIsDemo
                                    ? '#86efac'
                                    : '#fca5a5',
                            fontSize: 13,
                        }}
                    >
                        {accountIsDemo
                            ? '🟢 Compte Demo détecté'
                            : '🔴 Compte Demo non confirmé — proposition bloquée'}
                    </div>

                    {proposalMessage && (
                        <div
                            style={{
                                marginTop: 10,
                                color: '#86efac',
                                fontSize: 13,
                            }}
                        >
                            {proposalMessage}
                        </div>
                    )}

                    {proposalError && (
                        <div
                            style={{
                                marginTop: 10,
                                color: '#fca5a5',
                                fontSize: 13,
                            }}
                        >
                            {proposalError}
                        </div>
                    )}

                    {proposal && (
                        <div
                            style={{
                                marginTop: 14,
                                background:
                                    '#0f172a',
                                borderRadius: 12,
                                padding: 14,
                            }}
                        >
                            <div
                                style={{
                                    fontWeight: 800,
                                    marginBottom: 8,
                                }}
                            >
                                📋 Proposition reçue
                            </div>

                            <div
                                style={{
                                    display: 'grid',
                                    gap: 5,
                                    color: '#cbd5e1',
                                    fontSize: 13,
                                }}
                            >
                                <div>
                                    Type :{' '}
                                    {proposal.contract_type ||
                                        '—'}
                                </div>

                                <div>
                                    Prix demandé :{' '}
                                    {Number.isFinite(
                                        proposal.ask_price
                                    )
                                        ? proposal.ask_price?.toFixed(
                                              2
                                          )
                                        : '—'}
                                </div>

                                <div>
                                    Payout :{' '}
                                    {Number.isFinite(
                                        proposal.payout
                                    )
                                        ? proposal.payout?.toFixed(
                                              2
                                          )
                                        : '—'}
                                </div>

                                <div>
                                    Durée :{' '}
                                    {proposal.duration ||
                                        '—'}{' '}
                                    {proposal.duration_unit ||
                                        ''}
                                </div>
                            </div>

                            <div
                                style={{
                                    marginTop: 10,
                                    color: '#fbbf24',
                                    fontSize: 12,
                                    lineHeight: 1.45,
                                }}
                            >
                                ⚠️ Cette proposition
                                n'a pas été achetée.
                                Le code V4.12 n'envoie
                                volontairement aucun
                                ordre BUY.
                            </div>
                        </div>
                    )}
                </div>

                <div
                    style={{
                        background:
                            '#111827',
                        border:
                            '1px solid #243244',
                        borderRadius: 18,
                        padding: 18,
                        marginBottom: 14,
                    }}
                >
                    <div
                        style={{
                            fontSize: 18,
                            fontWeight: 800,
                            marginBottom: 12,
                        }}
                    >
                        📊 Informations
                    </div>

                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns:
                                'repeat(auto-fit,minmax(150px,1fr))',
                            gap: 8,
                        }}
                    >
                        <div
                            style={{
                                background:
                                    '#0f172a',
                                borderRadius: 12,
                                padding: 12,
                            }}
                        >
                            <div
                                style={{
                                    color: '#94a3b8',
                                    fontSize: 12,
                                }}
                            >
                                Historique
                            </div>

                            <div
                                style={{
                                    fontSize: 20,
                                    fontWeight: 800,
                                    marginTop: 5,
                                }}
                            >
                                {ticks.length}/
                                {HISTORY_SIZE}
                            </div>
                        </div>

                        <div
                            style={{
                                background:
                                    '#0f172a',
                                borderRadius: 12,
                                padding: 12,
                            }}
                        >
                            <div
                                style={{
                                    color: '#94a3b8',
                                    fontSize: 12,
                                }}
                            >
                                Observations
                            </div>

                            <div
                                style={{
                                    fontSize: 20,
                                    fontWeight: 800,
                                    marginTop: 5,
                                }}
                            >
                                {observations}
                            </div>
                        </div>

                        <div
                            style={{
                                background:
                                    '#0f172a',
                                borderRadius: 12,
                                padding: 12,
                            }}
                        >
                            <div
                                style={{
                                    color: '#94a3b8',
                                    fontSize: 12,
                                }}
                            >
                                Marché
                            </div>

                            <div
                                style={{
                                    fontSize: 18,
                                    fontWeight: 800,
                                    marginTop: 5,
                                }}
                            >
                                {MARKET_NAME}
                            </div>
                        </div>

                        <div
                            style={{
                                background:
                                    '#0f172a',
                                borderRadius: 12,
                                padding: 12,
                            }}
                        >
                            <div
                                style={{
                                    color: '#94a3b8',
                                    fontSize: 12,
                                }}
                            >
                                Dernière prédiction
                            </div>

                            <div
                                style={{
                                    fontSize: 18,
                                    fontWeight: 800,
                                    marginTop: 5,
                                }}
                            >
                                {finalPrediction ===
                                'FLAT'
                                    ? '—'
                                    : getPredictionText(
                                          finalPrediction
                                      )}
                            </div>
                        </div>
                    </div>
                </div>

                <div
                    style={{
                        background:
                            '#3f2a08',
                        border:
                            '1px solid #6b4f10',
                        borderRadius: 16,
                        padding: 15,
                        color: '#fde68a',
                        fontSize: 13,
                        lineHeight: 1.55,
                    }}
                >
                    <strong>
                        🔒 Sécurité V4.12
                    </strong>

                    <br />

                    • Le Paper Test est
                    entièrement virtuel.

                    <br />

                    • La section Proposition
                    demande seulement une
                    proposition.

                    <br />

                    • Aucun `buy` n'est présent
                    dans ce composant.

                    <br />

                    • Aucun ordre réel n'est
                    envoyé par ce fichier.

                    <br />

                    • Si le compte Demo n'est pas
                    clairement détecté, la demande
                    de proposition est bloquée.
                </div>
            </div>
        </div>
    );
};

export default R75TickMonitor;

import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';

const MARKET_SYMBOL = 'frxEURUSD';
const MARKET_NAME = 'EUR/USD';

const HISTORY_SIZE = 500;
const PAPER_TEST_LIMIT = 1000;
const BLOCK_SIZE = 100;
const ANALYSIS_WINDOW = 20;

const TICK_REQUEST_ID = 4111;
const HISTORY_REQUEST_ID = 4112;
const BALANCE_REQUEST_ID = 4113;

type Direction = 'UP' | 'DOWN' | 'FLAT';

type PaperResult = {
    total: number;
    wins: number;
    losses: number;
    pnl: number;
};

type TickData = {
    symbol?: string;
    quote?: number | string;
    epoch?: number;
    pip_size?: number;
};

const getQuote = (tick: TickData): number | null => {
    const quote = Number(tick?.quote);

    return Number.isFinite(quote) ? quote : null;
};

const getLastDigit = (
    quote: number,
    pipSize?: number
): string => {
    const digits =
        Number.isFinite(Number(pipSize)) &&
        Number(pipSize) >= 0
            ? Number(pipSize)
            : 5;

    const fixed = quote.toFixed(digits);

    const clean = fixed.replace('.', '');

    return clean.length > 0
        ? clean[clean.length - 1]
        : '—';
};

const getDirection = (
    previous: number | null,
    current: number
): Direction => {
    if (previous === null) {
        return 'FLAT';
    }

    if (current > previous) {
        return 'UP';
    }

    if (current < previous) {
        return 'DOWN';
    }

    return 'FLAT';
};

const calculatePrediction = (
    directions: Direction[]
): {
    prediction: Direction;
    strength: number;
} => {
    const usable = directions
        .filter(
            (direction) =>
                direction === 'UP' ||
                direction === 'DOWN'
        )
        .slice(-ANALYSIS_WINDOW);

    if (usable.length < 5) {
        return {
            prediction: 'FLAT',
            strength: 0,
        };
    }

    let upScore = 0;
    let downScore = 0;

    usable.forEach((direction, index) => {
        const weight = index + 1;

        if (direction === 'UP') {
            upScore += weight;
        } else {
            downScore += weight;
        }
    });

    const total = upScore + downScore;

    if (total <= 0) {
        return {
            prediction: 'FLAT',
            strength: 0,
        };
    }

    const difference = Math.abs(
        upScore - downScore
    );

    const strength = Math.min(
        100,
        (difference / total) * 100
    );

    if (strength < 10) {
        return {
            prediction: 'FLAT',
            strength,
        };
    }

    return {
        prediction:
            upScore >= downScore
                ? 'UP'
                : 'DOWN',
        strength,
    };
};

const R75TickMonitor = observer(() => {
    const { api_base } = useStore();

    const [connection, setConnection] =
        useState<
            'connecting' | 'connected' | 'waiting' | 'error'
        >('connecting');

    const [price, setPrice] =
        useState<number | null>(null);

    const [lastDigit, setLastDigit] =
        useState<string>('—');

    const [currentDirection, setCurrentDirection] =
        useState<Direction>('FLAT');

    const [prediction, setPrediction] =
        useState<Direction>('FLAT');

    const [predictionStrength, setPredictionStrength] =
        useState(0);

    const [observations, setObservations] =
        useState(0);

    const [historyCount, setHistoryCount] =
        useState(0);

    const [paperRunning, setPaperRunning] =
        useState(false);

    const [paperResult, setPaperResult] =
        useState<PaperResult>({
            total: 0,
            wins: 0,
            losses: 0,
            pnl: 0,
        });

    const [balance, setBalance] =
        useState<number | null>(null);

    const [loginId, setLoginId] =
        useState<string>('—');

    const [proposalStatus, setProposalStatus] =
        useState(
            '⏳ Initialisation de la connexion…'
        );

    const pricesRef =
        useRef<number[]>([]);

    const directionsRef =
        useRef<Direction[]>([]);

    const previousPredictionRef =
        useRef<Direction>('FLAT');

    const previousPriceRef =
        useRef<number | null>(null);

    const paperRunningRef =
        useRef(false);

    const paperResultRef =
        useRef<PaperResult>({
            total: 0,
            wins: 0,
            losses: 0,
            pnl: 0,
        });

    const unsubscribeRef =
        useRef<(() => void) | null>(null);

    const mountedRef =
        useRef(true);

    const processBalance = useCallback(
        (message: any) => {
            const rawBalance =
                Number(
                    message?.balance?.balance
                );

            if (Number.isFinite(rawBalance)) {
                setBalance(rawBalance);
            }

            const account =
                message?.balance?.loginid;

            if (
                typeof account === 'string' &&
                account.length > 0
            ) {
                setLoginId(account);
            }
        },
        []
    );

    const validatePreviousPrediction =
        useCallback(
            (
                newDirection: Direction
            ) => {
                if (!paperRunningRef.current) {
                    return;
                }

                const previousPrediction =
                    previousPredictionRef.current;

                if (
                    previousPrediction !== 'UP' &&
                    previousPrediction !== 'DOWN'
                ) {
                    return;
                }

                if (
                    newDirection !== 'UP' &&
                    newDirection !== 'DOWN'
                ) {
                    return;
                }

                const previous =
                    paperResultRef.current;

                const isWin =
                    previousPrediction ===
                    newDirection;

                const next: PaperResult = {
                    total:
                        previous.total + 1,
                    wins:
                        previous.wins +
                        (isWin ? 1 : 0),
                    losses:
                        previous.losses +
                        (isWin ? 0 : 1),
                    pnl:
                        previous.pnl +
                        (isWin ? 1 : -1),
                };

                paperResultRef.current = next;
                setPaperResult(next);

                if (
                    next.total >=
                    PAPER_TEST_LIMIT
                ) {
                    paperRunningRef.current =
                        false;

                    setPaperRunning(false);

                    setProposalStatus(
                        '🏁 Test Paper terminé : 1000/1000'
                    );
                }
            },
            []
        );

    const processTick = useCallback(
        (tick: TickData) => {
            if (!tick) {
                return;
            }

            const symbol =
                String(tick.symbol || '');

            if (symbol !== MARKET_SYMBOL) {
                return;
            }

            const quote =
                getQuote(tick);

            if (quote === null) {
                return;
            }

            const pipSize =
                Number(tick.pip_size);

            const direction =
                getDirection(
                    previousPriceRef.current,
                    quote
                );

            if (
                previousPriceRef.current !== null
            ) {
                validatePreviousPrediction(
                    direction
                );
            }

            previousPriceRef.current =
                quote;

            pricesRef.current = [
                ...pricesRef.current,
                quote,
            ].slice(-HISTORY_SIZE);

            directionsRef.current = [
                ...directionsRef.current,
                direction,
            ].slice(-HISTORY_SIZE);

            const nextHistoryCount =
                pricesRef.current.length;

            setHistoryCount(
                nextHistoryCount
            );

            setPrice(quote);

            setLastDigit(
                getLastDigit(
                    quote,
                    pipSize
                )
            );

            setCurrentDirection(
                direction
            );

            const analysis =
                calculatePrediction(
                    directionsRef.current
                );

            setPrediction(
                analysis.prediction
            );

            setPredictionStrength(
                analysis.strength
            );

            setObservations(
                directionsRef.current.length
            );

            if (
                analysis.prediction === 'UP' ||
                analysis.prediction === 'DOWN'
            ) {
                previousPredictionRef.current =
                    analysis.prediction;
            } else {
                previousPredictionRef.current =
                    'FLAT';
            }

            if (
                paperRunningRef.current &&
                paperResultRef.current.total <
                    PAPER_TEST_LIMIT
            ) {
                setProposalStatus(
                    `🧪 Paper Trading actif — ${paperResultRef.current.total}/${PAPER_TEST_LIMIT}`
                );
            }
        },
        [validatePreviousPrediction]
    );

    const handleDerivMessage =
        useCallback(
            (payload: any) => {
                const message =
                    payload?.data ??
                    payload;

                if (!message) {
                    return;
                }

                if (message.error) {
                    const errorCode =
                        String(
                            message.error.code ||
                                'UNKNOWN'
                        );

                    const errorMessage =
                        String(
                            message.error.message ||
                                'Erreur inconnue'
                        );

                    const requestedSymbol =
                        String(
                            message.echo_req
                                ?.ticks ||
                                message.echo_req
                                    ?.ticks_history ||
                                ''
                        );

                    console.error(
                        '🚨 ERREUR DERIV:',
                        {
                            code: errorCode,
                            message:
                                errorMessage,
                            requestedSymbol,
                            echo_req:
                                message.echo_req,
                        }
                    );

                    if (
                        requestedSymbol ===
                        MARKET_SYMBOL
                    ) {
                        setConnection(
                            'error'
                        );

                        setProposalStatus(
                            `🔴 Deriv ${errorCode}: ${errorMessage}`
                        );
                    }

                    return;
                }

                if (
                    message.msg_type ===
                    'balance'
                ) {
                    processBalance(
                        message
                    );

                    return;
                }

                if (
                    message.msg_type ===
                        'tick' &&
                    message.tick
                ) {
                    const symbol =
                        String(
                            message.tick
                                .symbol ||
                                ''
                        );

                    if (
                        symbol !==
                        MARKET_SYMBOL
                    ) {
                        return;
                    }

                    if (
                        mountedRef.current
                    ) {
                        setConnection(
                            'connected'
                        );
                    }

                    processTick(
                        message.tick
                    );
                }
            },
            [
                processBalance,
                processTick,
            ]
        );

    const requestBalance =
        useCallback(() => {
            if (!api_base?.api) {
                return;
            }

            try {
                api_base.api.send({
                    balance: 1,
                    req_id:
                        BALANCE_REQUEST_ID,
                });
            } catch (error) {
                console.error(
                    'Erreur demande balance:',
                    error
                );
            }
        }, [api_base]);

    const initialiseApi =
        useCallback(
            async () => {
                try {
                    if (!api_base?.api) {
                        await api_base.init();
                    }

                    if (!api_base?.api) {
                        throw new Error(
                            'api_base.api indisponible après initialisation.'
                        );
                    }

                    return true;
                } catch (error) {
                    console.error(
                        '❌ Erreur initialisation API:',
                        error
                    );

                    if (
                        mountedRef.current
                    ) {
                        setConnection(
                            'error'
                        );

                        setProposalStatus(
                            `🔴 Initialisation Deriv impossible : ${
                                error instanceof
                                Error
                                    ? error.message
                                    : 'erreur inconnue'
                            }`
                        );
                    }

                    return false;
                }
            },
            [api_base]
        );

    useEffect(() => {
        mountedRef.current = true;

        let cancelled = false;

        const startConnection =
            async () => {
                setConnection(
                    'connecting'
                );

                setProposalStatus(
                    '⏳ Connexion à Deriv…'
                );

                const ready =
                    await initialiseApi();

                if (
                    cancelled ||
                    !ready ||
                    !api_base?.api
                ) {
                    return;
                }

                try {
                    /*
                     * IMPORTANT :
                     * onMessage() retourne un flux.
                     * On s'abonne ensuite avec subscribe().
                     */
                    const messageStream =
                        api_base.api.onMessage();

                    const subscription =
                        messageStream.subscribe(
                            handleDerivMessage
                        );

                    unsubscribeRef.current =
                        subscription?.unsubscribe ||
                        null;

                    /*
                     * 1 — Historique EUR/USD
                     *
                     * Cela permet de remplir immédiatement
                     * les 500 ticks d'apprentissage quand
                     * le marché est ouvert.
                     */
                    try {
                        setProposalStatus(
                            '📚 Chargement de 500 ticks EUR/USD…'
                        );

                        const historyResponse =
                            await api_base.api.send(
                                {
                                    ticks_history:
                                        MARKET_SYMBOL,
                                    end: 'latest',
                                    count:
                                        HISTORY_SIZE,
                                    style: 'ticks',
                                    subscribe: 0,
                                    req_id:
                                        HISTORY_REQUEST_ID,
                                }
                            );

                        if (
                            cancelled
                        ) {
                            return;
                        }

                        const history =
                            historyResponse
                                ?.history;

                        const prices =
                            Array.isArray(
                                history?.prices
                            )
                                ? history.prices
                                      .map(
                                          (
                                              value: any
                                          ) =>
                                              Number(
                                                  value
                                              )
                                      )
                                      .filter(
                                          (
                                              value: number
                                          ) =>
                                              Number.isFinite(
                                                  value
                                              )
                                      )
                                : [];

                        if (
                            prices.length > 0
                        ) {
                            const limitedPrices =
                                prices.slice(
                                    -HISTORY_SIZE
                                );

                            pricesRef.current =
                                limitedPrices;

                            const historyDirections: Direction[] =
                                [];

                            for (
                                let i = 1;
                                i <
                                limitedPrices.length;
                                i++
                            ) {
                                historyDirections.push(
                                    getDirection(
                                        limitedPrices[
                                            i - 1
                                        ],
                                        limitedPrices[
                                            i
                                        ]
                                    )
                                );
                            }

                            directionsRef.current =
                                historyDirections;

                            const lastPrice =
                                limitedPrices[
                                    limitedPrices.length -
                                        1
                                ];

                            previousPriceRef.current =
                                lastPrice;

                            setPrice(
                                lastPrice
                            );

                            setHistoryCount(
                                limitedPrices.length
                            );

                            setObservations(
                                historyDirections.length
                            );

                            const analysis =
                                calculatePrediction(
                                    historyDirections
                                );

                            setPrediction(
                                analysis.prediction
                            );

                            setPredictionStrength(
                                analysis.strength
                            );

                            if (
                                historyDirections.length >
                                0
                            ) {
                                const lastDirection =
                                    historyDirections[
                                        historyDirections.length -
                                            1
                                    ];

                                setCurrentDirection(
                                    lastDirection
                                );
                            }

                            setProposalStatus(
                                `📚 Historique chargé : ${limitedPrices.length}/${HISTORY_SIZE}`
                            );
                        }
                    } catch (historyError) {
                        console.error(
                            '❌ Erreur historique EUR/USD:',
                            historyError
                        );

                        /*
                         * On ne bloque pas le flux live.
                         * Si l'historique échoue parce que le
                         * marché est fermé, l'erreur exacte
                         * envoyée par Deriv sera affichée par
                         * handleDerivMessage.
                         */
                    }

                    if (
                        cancelled
                    ) {
                        return;
                    }

                    /*
                     * 2 — Flux temps réel EUR/USD
                     */
                    api_base.api.send({
                        ticks:
                            MARKET_SYMBOL,
                        subscribe: 1,
                        req_id:
                            TICK_REQUEST_ID,
                    });

                    /*
                     * 3 — Solde
                     */
                    requestBalance();

                    if (
                        mountedRef.current
                    ) {
                        setConnection(
                            'waiting'
                        );

                        setProposalStatus(
                            '🟢 Connexion prête — attente des ticks EUR/USD…'
                        );
                    }
                } catch (error) {
                    console.error(
                        '❌ Erreur abonnement EUR/USD:',
                        error
                    );

                    if (
                        mountedRef.current
                    ) {
                        setConnection(
                            'error'
                        );

                        setProposalStatus(
                            `🔴 Erreur connexion : ${
                                error instanceof
                                Error
                                    ? error.message
                                    : 'erreur inconnue'
                            }`
                        );
                    }
                }
            };

        startConnection();

        return () => {
            cancelled = true;
            mountedRef.current = false;

            if (
                unsubscribeRef.current
            ) {
                try {
                    unsubscribeRef.current();
                } catch (error) {
                    console.error(
                        'Erreur unsubscribe:',
                        error
                    );
                }

                unsubscribeRef.current =
                    null;
            }
        };
    }, [
        api_base,
        handleDerivMessage,
        initialiseApi,
        requestBalance,
    ]);

    const startPaperTest =
        useCallback(() => {
            paperResultRef.current = {
                total: 0,
                wins: 0,
                losses: 0,
                pnl: 0,
            };

            setPaperResult({
                total: 0,
                wins: 0,
                losses: 0,
                pnl: 0,
            });

            paperRunningRef.current =
                true;

            setPaperRunning(true);

            previousPredictionRef.current =
                prediction;

            setProposalStatus(
                '🧪 Paper Trading démarré — aucun ordre envoyé'
            );
        }, [prediction]);

    const stopPaperTest =
        useCallback(() => {
            paperRunningRef.current =
                false;

            setPaperRunning(false);

            setProposalStatus(
                `⏹️ Paper Trading arrêté — ${paperResultRef.current.total}/${PAPER_TEST_LIMIT}`
            );
        }, []);

    const resetPaperTest =
        useCallback(() => {
            paperRunningRef.current =
                false;

            setPaperRunning(false);

            paperResultRef.current = {
                total: 0,
                wins: 0,
                losses: 0,
                pnl: 0,
            };

            previousPredictionRef.current =
                'FLAT';

            setPaperResult({
                total: 0,
                wins: 0,
                losses: 0,
                pnl: 0,
            });

            setProposalStatus(
                '🧹 Paper Trading réinitialisé'
            );
        }, []);

    const winRate = useMemo(() => {
        if (paperResult.total === 0) {
            return 0;
        }

        return (
            (paperResult.wins /
                paperResult.total) *
            100
        );
    }, [paperResult]);

    const lossRate = useMemo(() => {
        if (paperResult.total === 0) {
            return 0;
        }

        return (
            (paperResult.losses /
                paperResult.total) *
            100
        );
    }, [paperResult]);

    const blocksCompleted =
        Math.floor(
            paperResult.total /
                BLOCK_SIZE
        );

    const currentBlockProgress =
        paperResult.total === 0
            ? 0
            : paperResult.total %
                  BLOCK_SIZE ===
              0
            ? BLOCK_SIZE
            : paperResult.total %
              BLOCK_SIZE;

    const currentBlock =
        paperResult.total === 0
            ? 0
            : Math.min(
                  10,
                  Math.ceil(
                      paperResult.total /
                          BLOCK_SIZE
                  )
              );

    const connectionLabel =
        connection === 'connected'
            ? '🟢 Connecté à Deriv — EUR/USD'
            : connection === 'waiting'
            ? '🟢 Connexion établie — attente EUR/USD'
            : connection === 'error'
            ? '🔴 Erreur EUR/USD'
            : '🟠 Connexion à Deriv…';

    const directionLabel =
        currentDirection === 'UP'
            ? '🟢 HAUSSE'
            : currentDirection ===
              'DOWN'
            ? '🔴 BAISSE'
            : '⚪ STABLE';

    const predictionLabel =
        prediction === 'UP'
            ? '🟢 HAUSSE'
            : prediction === 'DOWN'
            ? '🔴 BAISSE'
            : '⚪ STABLE';

    return (
        <div
            style={{
                width: '100%',
                minHeight: '100dvh',
                overflowY: 'auto',
                overflowX: 'hidden',
                WebkitOverflowScrolling:
                    'touch',
                background:
                    '#0f172a',
                color: '#e5e7eb',
                padding: '16px',
                paddingBottom: '70px',
                fontFamily:
                    'Arial, sans-serif',
                boxSizing:
                    'border-box',
            }}
        >
            <div
                style={{
                    maxWidth:
                        '760px',
                    margin:
                        '0 auto',
                }}
            >
                <h1
                    style={{
                        fontSize:
                            '22px',
                        marginBottom:
                            '8px',
                    }}
                >
                    📈 Moniteur Forex EUR/USD
                    — V4.11.1
                </h1>

                <div
                    style={{
                        background:
                            '#1e293b',
                        padding:
                            '14px',
                        borderRadius:
                            '12px',
                        marginBottom:
                            '12px',
                    }}
                >
                    <strong>
                        {connectionLabel}
                    </strong>
                </div>

                <div
                    style={{
                        background:
                            '#1e293b',
                        padding:
                            '14px',
                        borderRadius:
                            '12px',
                        marginBottom:
                            '12px',
                    }}
                >
                    <h2>
                        💰 Compte Deriv
                    </h2>

                    <div
                        style={{
                            fontSize:
                                '22px',
                            fontWeight:
                                'bold',
                        }}
                    >
                        {balance !== null
                            ? `${balance.toFixed(
                                  2
                              )} USD`
                            : '—'}
                    </div>

                    <div>
                        Compte :{' '}
                        {loginId}
                    </div>

                    <div
                        style={{
                            marginTop:
                                '8px',
                        }}
                    >
                        {balance !== null
                            ? '🟢 Solde reçu depuis Deriv'
                            : '🟠 En attente du solde'}
                    </div>
                </div>

                <div
                    style={{
                        background:
                            '#1e293b',
                        padding:
                            '14px',
                        borderRadius:
                            '12px',
                        marginBottom:
                            '12px',
                    }}
                >
                    <h2>
                        📊 Marché
                    </h2>

                    <p>
                        <strong>
                            Marché
                        </strong>
                        <br />
                        {MARKET_NAME}
                    </p>

                    <p>
                        <strong>
                            Symbole
                        </strong>
                        <br />
                        {MARKET_SYMBOL}
                    </p>

                    <p>
                        <strong>
                            Prix
                        </strong>
                        <br />
                        {price !== null
                            ? price.toFixed(
                                  5
                              )
                            : '—'}
                    </p>

                    <p>
                        <strong>
                            Dernier chiffre
                        </strong>
                        <br />
                        {lastDigit}
                    </p>
                </div>

                <div
                    style={{
                        background:
                            '#1e293b',
                        padding:
                            '14px',
                        borderRadius:
                            '12px',
                        marginBottom:
                            '12px',
                    }}
                >
                    <h2>
                        🧠 Phase 1 —
                        Apprentissage
                    </h2>

                    <p>
                        Historique :{' '}
                        {historyCount}/
                        {HISTORY_SIZE}
                    </p>

                    <p>
                        {historyCount >=
                        HISTORY_SIZE
                            ? '🟢 Historique complet'
                            : '🧠 Collecte de données…'}
                    </p>
                </div>

                <div
                    style={{
                        background:
                            '#1e293b',
                        padding:
                            '14px',
                        borderRadius:
                            '12px',
                        marginBottom:
                            '12px',
                    }}
                >
                    <h2>
                        🔎 Analyse en
                        temps réel
                    </h2>

                    <p>
                        <strong>
                            Direction actuelle
                        </strong>
                        <br />
                        {directionLabel}
                    </p>

                    <p>
                        <strong>
                            Prochaine
                            prédiction
                        </strong>
                        <br />
                        {predictionLabel}
                    </p>

                    <p>
                        <strong>
                            Force
                        </strong>
                        <br />
                        {predictionStrength.toFixed(
                            1
                        )}
                        %
                    </p>

                    <p>
                        <strong>
                            Observations
                        </strong>
                        <br />
                        {observations}
                    </p>

                    <div
                        style={{
                            background:
                                '#334155',
                            padding:
                                '10px',
                            borderRadius:
                                '8px',
                            marginTop:
                                '10px',
                        }}
                    >
                        ℹ️ L'analyse utilise
                        les dernières
                        directions du marché
                        pour produire une
                        indication UP/DOWN.
                    </div>
                </div>

                <div
                    style={{
                        background:
                            '#1e293b',
                        padding:
                            '14px',
                        borderRadius:
                            '12px',
                        marginBottom:
                            '12px',
                    }}
                >
                    <h2>
                        🎮 Test Demo
                    </h2>

                    <p>
                        Le bouton démarre
                        le test de la
                        stratégie avec les
                        ticks EUR/USD en
                        mode virtuel.
                    </p>

                    {!paperRunning ? (
                        <button
                            onClick={
                                startPaperTest
                            }
                            style={{
                                width:
                                    '100%',
                                padding:
                                    '14px',
                                borderRadius:
                                    '10px',
                                border:
                                    'none',
                                fontWeight:
                                    'bold',
                                fontSize:
                                    '16px',
                                cursor:
                                    'pointer',
                            }}
                        >
                            ▶️ TESTER SUR
                            COMPTE DÉMO
                        </button>
                    ) : (
                        <button
                            onClick={
                                stopPaperTest
                            }
                            style={{
                                width:
                                    '100%',
                                padding:
                                    '14px',
                                borderRadius:
                                    '10px',
                                border:
                                    'none',
                                fontWeight:
                                    'bold',
                                fontSize:
                                    '16px',
                                cursor:
                                    'pointer',
                            }}
                        >
                            ⏹️ ARRÊTER LE
                            TEST
                        </button>
                    )}

                    <button
                        onClick={
                            resetPaperTest
                        }
                        style={{
                            width:
                                '100%',
                            padding:
                                '10px',
                            marginTop:
                                '8px',
                            borderRadius:
                                '10px',
                            border:
                                'none',
                            cursor:
                                'pointer',
                        }}
                    >
                        🔄 Réinitialiser
                    </button>

                    <p>
                        {proposalStatus}
                    </p>
                </div>

                <div
                    style={{
                        background:
                            '#1e293b',
                        padding:
                            '14px',
                        borderRadius:
                            '12px',
                        marginBottom:
                            '12px',
                    }}
                >
                    <h2>
                        🛡️ SÉCURITÉ
                    </h2>

                    <p>
                        Cette V4.11.1
                        n'envoie aucun
                        ordre BUY/SELL à
                        Deriv.
                    </p>

                    <p>
                        Les résultats
                        restent virtuels.
                    </p>
                </div>

                <div
                    style={{
                        background:
                            '#1e293b',
                        padding:
                            '14px',
                        borderRadius:
                            '12px',
                        marginBottom:
                            '12px',
                    }}
                >
                    <h2>
                        🧪 Phase 2 —
                        Paper Trading
                    </h2>

                    <p>
                        <strong>
                            Tests
                        </strong>
                        <br />
                        {paperResult.total}/
                        {PAPER_TEST_LIMIT}
                    </p>

                    <p>
                        <strong>
                            Gains
                        </strong>
                        <br />
                        {paperResult.wins}
                    </p>

                    <p>
                        <strong>
                            Pertes
                        </strong>
                        <br />
                        {paperResult.losses}
                    </p>

                    <p>
                        <strong>
                            Taux gain
                        </strong>
                        <br />
                        {winRate.toFixed(
                            2
                        )}
                        %
                    </p>

                    <p>
                        <strong>
                            Taux perte
                        </strong>
                        <br />
                        {lossRate.toFixed(
                            2
                        )}
                        %
                    </p>

                    <p>
                        <strong>
                            Résultat virtuel
                        </strong>
                        <br />
                        {paperResult.pnl >=
                        0
                            ? '+'
                            : ''}
                        {paperResult.pnl}
                    </p>

                    <p>
                        +1 prédiction
                        correcte / -1
                        prédiction
                        incorrecte
                    </p>
                </div>

                <div
                    style={{
                        background:
                            '#1e293b',
                        padding:
                            '14px',
                        borderRadius:
                            '12px',
                        marginBottom:
                            '12px',
                    }}
                >
                    <h2>
                        📦 Blocs de 100
                    </h2>

                    <p>
                        Blocs terminés :{' '}
                        {blocksCompleted}
                    </p>

                    <p>
                        Bloc actuel :{' '}
                        {currentBlock}/
                        {currentBlockProgress}
                    </p>
                </div>

                <div
                    style={{
                        background:
                            '#1e293b',
                        padding:
                            '14px',
                        borderRadius:
                            '12px',
                        marginBottom:
                            '12px',
                    }}
                >
                    🧠{' '}
                    {historyCount <
                    HISTORY_SIZE
                        ? 'Collecte de données…'
                        : paperRunning
                        ? 'Paper Trading en cours…'
                        : 'Prêt pour le test Paper'}
                </div>

                <div
                    style={{
                        background:
                            '#172033',
                        padding:
                            '14px',
                        borderRadius:
                            '12px',
                        marginBottom:
                            '12px',
                    }}
                >
                    <strong>
                        🛡️ MODE TEST UNIQUEMENT
                    </strong>

                    <p>
                        ❌ Aucun trade
                        automatique réel ou
                        Demo n'est envoyé.
                    </p>

                    <p>
                        Le bouton « Tester
                        sur compte Demo »
                        démarre le paper
                        test avec les données
                        réelles du marché,
                        mais sans ordre
                        financier.
                    </p>
                </div>

                <div
                    style={{
                        textAlign:
                            'center',
                        padding:
                            '12px',
                    }}
                >
                    ↕️ Fais glisser
                    l'écran pour voir
                    toutes les informations
                </div>
            </div>
        </div>
    );
});

export default R75TickMonitor;

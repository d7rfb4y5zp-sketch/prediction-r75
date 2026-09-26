import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';

const MARKET_SYMBOL = 'frxEURUSD';
const MARKET_NAME = 'EUR/USD';

const HISTORY_SIZE = 500;
const PAPER_TEST_LIMIT = 1000;
const BLOCK_SIZE = 100;
const ANALYSIS_WINDOW = 20;

const TICK_REQUEST_ID = 4112;
const HISTORY_REQUEST_ID = 4113;
const BALANCE_REQUEST_ID = 4114;

type Direction = 'UP' | 'DOWN' | 'FLAT';

type TickData = {
    quote?: number;
    epoch?: number;
    symbol?: string;
    pip_size?: number;
};

type PaperResult = {
    total: number;
    wins: number;
    losses: number;
    pnl: number;
};

const getDirection = (
    previous: number,
    current: number
): Direction => {
    if (current > previous) return 'UP';
    if (current < previous) return 'DOWN';
    return 'FLAT';
};

const getLastDigit = (
    price: number,
    pipSize?: number
): string => {
    if (!Number.isFinite(price)) {
        return '—';
    }

    const digits =
        Number.isFinite(pipSize) &&
        Number(pipSize) >= 0
            ? Number(pipSize)
            : 5;

    const formatted = Number(price).toFixed(digits);

    const clean = formatted.replace('.', '');

    return clean.length > 0
        ? clean.charAt(clean.length - 1)
        : '—';
};

const normalizeMessage = (
    rawMessage: any
): any => {
    if (!rawMessage) {
        return null;
    }

    if (
        rawMessage.data &&
        typeof rawMessage.data === 'object'
    ) {
        return rawMessage.data;
    }

    return rawMessage;
};

const R75TickMonitor = () => {
    const [connection, setConnection] =
        useState<
            'connecting' | 'waiting' | 'connected' | 'closed' | 'error'
        >('connecting');

    const [connectionMessage, setConnectionMessage] =
        useState('');

    const [price, setPrice] = useState<number | null>(
        null
    );

    const [lastDigit, setLastDigit] =
        useState('—');

    const [currentDirection, setCurrentDirection] =
        useState<Direction>('FLAT');

    const [prediction, setPrediction] =
        useState<Direction>('FLAT');

    const [predictionStrength, setPredictionStrength] =
        useState(0);

    const [observations, setObservations] =
        useState(0);

    const [priceHistory, setPriceHistory] =
        useState<number[]>([]);

    const [directionHistory, setDirectionHistory] =
        useState<Direction[]>([]);

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
        useState('');

    const [proposalStatus, setProposalStatus] =
        useState('');

    const [marketClosed, setMarketClosed] =
        useState(false);

    const [marketOpenMessage, setMarketOpenMessage] =
        useState('');

    const [historyLoaded, setHistoryLoaded] =
        useState(false);

    const previousPredictionRef =
        useRef<Direction>('FLAT');

    const paperRunningRef =
        useRef(false);

    const directionHistoryRef =
        useRef<Direction[]>([]);

    const priceHistoryRef =
        useRef<number[]>([]);

    const unsubscribeRef =
        useRef<(() => void) | null>(null);

    const retryTimerRef =
        useRef<ReturnType<typeof setTimeout> | null>(
            null
        );

    const mountedRef =
        useRef(true);

    const predictFromDirections =
        useCallback(
            (
                directions: Direction[]
            ): {
                prediction: Direction;
                strength: number;
            } => {
                const usable =
                    directions
                        .filter(
                            direction =>
                                direction === 'UP' ||
                                direction === 'DOWN'
                        )
                        .slice(
                            -ANALYSIS_WINDOW
                        );

                if (usable.length < 4) {
                    return {
                        prediction: 'FLAT',
                        strength: 0,
                    };
                }

                let upScore = 0;
                let downScore = 0;

                usable.forEach(
                    (
                        direction,
                        index
                    ) => {
                        const weight =
                            index + 1;

                        if (
                            direction === 'UP'
                        ) {
                            upScore += weight;
                        } else {
                            downScore += weight;
                        }
                    }
                );

                const total =
                    upScore + downScore;

                if (total <= 0) {
                    return {
                        prediction: 'FLAT',
                        strength: 0,
                    };
                }

                const difference =
                    Math.abs(
                        upScore -
                            downScore
                    );

                const strength = Math.min(
                    95,
                    (difference /
                        total) *
                        100
                );

                if (
                    strength < 10
                ) {
                    return {
                        prediction: 'FLAT',
                        strength,
                    };
                }

                return {
                    prediction:
                        upScore >
                        downScore
                            ? 'UP'
                            : 'DOWN',
                    strength,
                };
            },
            []
        );

    const applyPrediction =
        useCallback(
            (
                directions: Direction[]
            ) => {
                const result =
                    predictFromDirections(
                        directions
                    );

                setPrediction(
                    result.prediction
                );

                setPredictionStrength(
                    result.strength
                );

                previousPredictionRef.current =
                    result.prediction;
            },
            [predictFromDirections]
        );

    const addTickToHistory =
        useCallback(
            (
                tick: TickData
            ) => {
                const quote =
                    Number(tick.quote);

                if (
                    !Number.isFinite(
                        quote
                    )
                ) {
                    return;
                }

                const symbol =
                    String(
                        tick.symbol ||
                            ''
                    );

                if (
                    symbol !==
                    MARKET_SYMBOL
                ) {
                    return;
                }

                const pipSize =
                    Number(
                        tick.pip_size
                    );

                setPrice(quote);

                setLastDigit(
                    getLastDigit(
                        quote,
                        pipSize
                    )
                );

                const previousPrice =
                    priceHistoryRef.current[
                        priceHistoryRef.current
                            .length - 1
                    ];

                let newDirection: Direction =
                    'FLAT';

                if (
                    Number.isFinite(
                        previousPrice
                    )
                ) {
                    newDirection =
                        getDirection(
                            Number(
                                previousPrice
                            ),
                            quote
                        );
                }

                if (
                    newDirection !==
                    'FLAT'
                ) {
                    setCurrentDirection(
                        newDirection
                    );
                } else {
                    setCurrentDirection(
                        'FLAT'
                    );
                }

                const nextPrices = [
                    ...priceHistoryRef.current,
                    quote,
                ].slice(
                    -HISTORY_SIZE
                );

                priceHistoryRef.current =
                    nextPrices;

                setPriceHistory(
                    nextPrices
                );

                if (
                    newDirection !==
                    'FLAT'
                ) {
                    const nextDirections =
                        [
                            ...directionHistoryRef.current,
                            newDirection,
                        ].slice(
                            -HISTORY_SIZE
                        );

                    directionHistoryRef.current =
                        nextDirections;

                    setDirectionHistory(
                        nextDirections
                    );

                    setObservations(
                        nextDirections.length
                    );

                    if (
                        nextDirections.length >=
                        4
                    ) {
                        applyPrediction(
                            nextDirections
                        );
                    }
                }

                if (
                    paperRunningRef.current &&
                    newDirection !==
                        'FLAT'
                ) {
                    const oldPrediction =
                        previousPredictionRef.current;

                    if (
                        oldPrediction ===
                            'UP' ||
                        oldPrediction ===
                            'DOWN'
                    ) {
                        const win =
                            oldPrediction ===
                            newDirection;

                        setPaperResult(
                            previous => {
                                if (
                                    previous.total >=
                                    PAPER_TEST_LIMIT
                                ) {
                                    paperRunningRef.current =
                                        false;
                                    setPaperRunning(
                                        false
                                    );
                                    return previous;
                                }

                                return {
                                    total:
                                        previous.total +
                                        1,
                                    wins:
                                        previous.wins +
                                        (win
                                            ? 1
                                            : 0),
                                    losses:
                                        previous.losses +
                                        (win
                                            ? 0
                                            : 1),
                                    pnl:
                                        previous.pnl +
                                        (win
                                            ? 1
                                            : -1),
                                };
                            }
                        );
                    }
                }
            },
            [applyPrediction]
        );

    const processHistory =
        useCallback(
            (
                message: any
            ) => {
                const history =
                    message?.history;

                if (
                    !history ||
                    !Array.isArray(
                        history.prices
                    )
                ) {
                    return;
                }

                const prices =
                    history.prices
                        .map(
                            (value: any) =>
                                Number(
                                    value
                                )
                        )
                        .filter(
                            (value: number) =>
                                Number.isFinite(
                                    value
                                )
                        )
                        .slice(
                            -HISTORY_SIZE
                        );

                if (
                    prices.length === 0
                ) {
                    return;
                }

                const directions: Direction[] =
                    [];

                for (
                    let i = 1;
                    i <
                    prices.length;
                    i += 1
                ) {
                    const direction =
                        getDirection(
                            prices[
                                i - 1
                            ],
                            prices[i]
                        );

                    if (
                        direction !==
                        'FLAT'
                    ) {
                        directions.push(
                            direction
                        );
                    }
                }

                priceHistoryRef.current =
                    prices;

                directionHistoryRef.current =
                    directions.slice(
                        -HISTORY_SIZE
                    );

                setPriceHistory(
                    prices
                );

                setDirectionHistory(
                    directionHistoryRef.current
                );

                const lastPrice =
                    prices[
                        prices.length - 1
                    ];

                setPrice(lastPrice);

                const pipSize =
                    Number(
                        message?.pip_size
                    );

                setLastDigit(
                    getLastDigit(
                        lastPrice,
                        pipSize
                    )
                );

                if (
                    directions.length >
                    0
                ) {
                    const lastDirection =
                        directions[
                            directions.length -
                                1
                        ];

                    setCurrentDirection(
                        lastDirection
                    );

                    setObservations(
                        directions.length
                    );

                    applyPrediction(
                        directions
                    );
                }

                setHistoryLoaded(
                    true
                );
            },
            [applyPrediction]
        );

    const handleDerivMessage =
        useCallback(
            (rawMessage: any) => {
                const message =
                    normalizeMessage(
                        rawMessage
                    );

                if (!message) {
                    return;
                }

                if (
                    message.error
                ) {
                    const code =
                        String(
                            message
                                .error
                                .code ||
                                'UNKNOWN'
                        );

                    const errorMessage =
                        String(
                            message
                                .error
                                .message ||
                                'Erreur inconnue'
                        );

                    const requestedSymbol =
                        String(
                            message
                                .echo_req
                                ?.ticks ||
                                message
                                    .echo_req
                                    ?.ticks_history ||
                                ''
                        );

                    console.error(
                        '🚨 ERREUR DERIV COMPLETE:',
                        {
                            code,
                            message:
                                errorMessage,
                            requestedSymbol,
                            echo_req:
                                message.echo_req,
                        }
                    );

                    if (
                        requestedSymbol ===
                        MARKET_SYMBOL ||
                        code ===
                            'MarketIsClosed'
                    ) {
                        if (
                            code ===
                            'MarketIsClosed'
                        ) {
                            setMarketClosed(
                                true
                            );

                            setConnection(
                                'closed'
                            );

                            setHistoryLoaded(
                                false
                            );

                            setMarketOpenMessage(
                                errorMessage
                            );

                            setProposalStatus(
                                `🔴 EUR/USD fermé — ${errorMessage}`
                            );
                        } else {
                            setConnection(
                                'error'
                            );

                            setProposalStatus(
                                `🔴 Deriv ${code}: ${errorMessage}`
                            );
                        }
                    }

                    return;
                }

                if (
                    message.msg_type ===
                    'balance'
                ) {
                    const rawBalance =
                        Number(
                            message
                                ?.balance
                                ?.balance
                        );

                    if (
                        Number.isFinite(
                            rawBalance
                        )
                    ) {
                        setBalance(
                            rawBalance
                        );
                    }

                    const account =
                        message
                            ?.balance
                            ?.loginid;

                    if (
                        typeof account ===
                            'string' &&
                        account.length >
                            0
                    ) {
                        setLoginId(
                            account
                        );
                    }

                    return;
                }

                if (
                    message.msg_type ===
                    'history'
                ) {
                    const requestedSymbol =
                        String(
                            message
                                .echo_req
                                ?.ticks_history ||
                                ''
                        );

                    if (
                        requestedSymbol ===
                            MARKET_SYMBOL ||
                        message
                            ?.history
                    ) {
                        processHistory(
                            message
                        );

                        setMarketClosed(
                            false
                        );

                        setConnection(
                            'connected'
                        );

                        setConnectionMessage(
                            `🟢 Connecté — ${MARKET_NAME}`
                        );

                        setProposalStatus(
                            '🟢 EUR/USD ouvert — données reçues'
                        );
                    }

                    return;
                }

                if (
                    message.msg_type ===
                        'tick' &&
                    message.tick
                ) {
                    const symbol =
                        String(
                            message
                                .tick
                                .symbol ||
                                ''
                        );

                    if (
                        symbol !==
                        MARKET_SYMBOL
                    ) {
                        return;
                    }

                    setMarketClosed(
                        false
                    );

                    setConnection(
                        'connected'
                    );

                    setConnectionMessage(
                        `🟢 Connecté — ${MARKET_NAME}`
                    );

                    setProposalStatus(
                        '🟢 Flux EUR/USD actif — mode test uniquement'
                    );

                    addTickToHistory(
                        message.tick
                    );
                }
            },
            [addTickToHistory, processHistory]
        );

    const requestBalance =
        useCallback(() => {
            if (!api_base.api) {
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
        }, []);

    const requestMarketData =
        useCallback(async () => {
            if (!api_base.api) {
                return;
            }

            setConnection(
                'waiting'
            );

            setConnectionMessage(
                `🟡 Vérification du marché ${MARKET_NAME}…`
            );

            try {
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
                    historyResponse
                ) {
                    handleDerivMessage(
                        historyResponse
                    );
                }

                if (
                    marketClosed
                ) {
                    return;
                }

                api_base.api.send({
                    ticks:
                        MARKET_SYMBOL,
                    subscribe: 1,
                    req_id:
                        TICK_REQUEST_ID,
                });

                setProposalStatus(
                    '🟡 Connexion au flux EUR/USD…'
                );
            } catch (error: any) {
                console.error(
                    'Erreur historique EUR/USD:',
                    error
                );

                const message =
                    String(
                        error?.message ||
                            error ||
                            'Erreur inconnue'
                    );

                if (
                    message.includes(
                        'MarketIsClosed'
                    ) ||
                    message.includes(
                        'market is presently closed'
                    )
                ) {
                    setMarketClosed(
                        true
                    );

                    setConnection(
                        'closed'
                    );

                    setProposalStatus(
                        `🔴 EUR/USD fermé — ${message}`
                    );
                } else {
                    setConnection(
                        'error'
                    );

                    setProposalStatus(
                        `🔴 Erreur EUR/USD — ${message}`
                    );
                }
            }
        }, [
            handleDerivMessage,
            marketClosed,
        ]);

    const initialiseApi =
        useCallback(
            async () => {
                try {
                    if (!api_base.api) {
                        await api_base.init();
                    }

                    if (
                        !api_base.api
                    ) {
                        setConnection(
                            'error'
                        );

                        setProposalStatus(
                            '🔴 api_base.api indisponible'
                        );

                        return false;
                    }

                    return true;
                } catch (error) {
                    console.error(
                        'Erreur initialisation API:',
                        error
                    );

                    setConnection(
                        'error'
                    );

                    setProposalStatus(
                        '🔴 Erreur initialisation Deriv'
                    );

                    return false;
                }
            },
            []
        );

    useEffect(() => {
        mountedRef.current =
            true;

        let cancelled = false;

        const start =
            async () => {
                setConnection(
                    'connecting'
                );

                const ready =
                    await initialiseApi();

                if (
                    cancelled ||
                    !ready ||
                    !api_base.api
                ) {
                    return;
                }

                try {
                    const messageStream =
                        api_base.api.onMessage();

                    const subscription =
                        messageStream.subscribe(
                            handleDerivMessage
                        );

                    unsubscribeRef.current =
                        subscription?.unsubscribe ||
                        null;

                    requestBalance();

                    await requestMarketData();

                    if (
                        cancelled
                    ) {
                        return;
                    }

                    if (
                        !marketClosed &&
                        api_base.api
                    ) {
                        try {
                            api_base.api.send(
                                {
                                    ticks:
                                        MARKET_SYMBOL,
                                    subscribe: 1,
                                    req_id:
                                        TICK_REQUEST_ID,
                                }
                            );
                        } catch (
                            error
                        ) {
                            console.error(
                                'Erreur abonnement ticks:',
                                error
                            );
                        }
                    }
                } catch (error) {
                    console.error(
                        'Erreur abonnement:',
                        error
                    );

                    setConnection(
                        'error'
                    );

                    setProposalStatus(
                        '🔴 Erreur abonnement Deriv'
                    );
                }
            };

        start();

        return () => {
            cancelled =
                true;

            mountedRef.current =
                false;

            if (
                retryTimerRef.current
            ) {
                clearTimeout(
                    retryTimerRef.current
                );

                retryTimerRef.current =
                    null;
            }

            if (
                unsubscribeRef.current
            ) {
                unsubscribeRef.current();

                unsubscribeRef.current =
                    null;
            }
        };
    }, [
        handleDerivMessage,
        initialiseApi,
        requestBalance,
        requestMarketData,
    ]);

    useEffect(() => {
        if (
            !marketClosed
        ) {
            return;
        }

        if (
            retryTimerRef.current
        ) {
            return;
        }

        retryTimerRef.current =
            setTimeout(
                async () => {
                    retryTimerRef.current =
                        null;

                    if (
                        !mountedRef.current ||
                        !api_base.api
                    ) {
                        return;
                    }

                    console.log(
                        '🔄 Nouvelle vérification EUR/USD…'
                    );

                    await requestMarketData();
                },
                60000
            );

        return () => {
            if (
                retryTimerRef.current
            ) {
                clearTimeout(
                    retryTimerRef.current
                );

                retryTimerRef.current =
                    null;
            }
        };
    }, [
        marketClosed,
        requestMarketData,
    ]);

    const startPaperTest =
        useCallback(() => {
            if (
                observations < 4
            ) {
                setProposalStatus(
                    '⚠️ Pas assez de données pour démarrer le Paper Test.'
                );

                return;
            }

            paperRunningRef.current =
                true;

            setPaperRunning(
                true
            );

            setProposalStatus(
                '🟢 Paper Trading démarré — aucun ordre BUY/SELL.'
            );
        }, [observations]);

    const stopPaperTest =
        useCallback(() => {
            paperRunningRef.current =
                false;

            setPaperRunning(
                false
            );

            setProposalStatus(
                '⏹️ Paper Trading arrêté — résultats conservés.'
            );
        }, []);

    const resetPaperTest =
        useCallback(() => {
            paperRunningRef.current =
                false;

            setPaperRunning(
                false
            );

            setPaperResult({
                total: 0,
                wins: 0,
                losses: 0,
                pnl: 0,
            });

            previousPredictionRef.current =
                prediction;

            setProposalStatus(
                '🔄 Paper Trading réinitialisé.'
            );
        }, [prediction]);

    const winRate = useMemo(() => {
        if (
            paperResult.total === 0
        ) {
            return 0;
        }

        return (
            (paperResult.wins /
                paperResult.total) *
            100
        );
    }, [paperResult]);

    const lossRate = useMemo(() => {
        if (
            paperResult.total === 0
        ) {
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

    const phaseOneComplete =
        directionHistory.length >=
        HISTORY_SIZE;

    const connectionLabel =
        connection ===
        'connected'
            ? connectionMessage ||
              `🟢 Connecté — ${MARKET_NAME}`
            : connection ===
              'closed'
            ? '🔴 Marché fermé'
            : connection ===
              'error'
            ? '🔴 Erreur EUR/USD'
            : connection ===
              'waiting'
            ? '🟡 Connexion EUR/USD…'
            : '🟠 Connexion à Deriv…';

    const directionLabel =
        currentDirection ===
        'UP'
            ? '🟢 HAUSSE'
            : currentDirection ===
              'DOWN'
            ? '🔴 BAISSE'
            : '⚪ STABLE';

    const predictionLabel =
        prediction ===
        'UP'
            ? '🟢 HAUSSE'
            : prediction ===
              'DOWN'
            ? '🔴 BAISSE'
            : '⚪ STABLE';

    return (
        <div
            style={{
                width: '100%',
                minHeight: '100vh',
                height: '100dvh',
                overflowY: 'auto',
                overflowX: 'hidden',
                WebkitOverflowScrolling:
                    'touch',
                overscrollBehaviorY:
                    'auto',
                touchAction:
                    'pan-y',
                background:
                    '#0f172a',
                color: '#e5e7eb',
                padding: '16px',
                paddingBottom:
                    '70px',
                fontFamily:
                    'Arial, sans-serif',
                boxSizing:
                    'border-box',
            }}
        >
            <div
                style={{
                    maxWidth:
                        '900px',
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
                    📈 Moniteur Forex
                    EUR/USD —
                    V4.11.2
                </h1>

                <div
                    style={{
                        marginBottom:
                            '14px',
                        fontSize:
                            '14px',
                    }}
                >
                    Demo + Paper
                    Trader +
                    Proposition
                </div>

                <div
                    style={{
                        background:
                            '#111827',
                        borderRadius:
                            '12px',
                        padding:
                            '14px',
                        marginBottom:
                            '12px',
                    }}
                >
                    <strong>
                        {connectionLabel}
                    </strong>

                    {marketClosed && (
                        <div
                            style={{
                                marginTop:
                                    '10px',
                                padding:
                                    '10px',
                                borderRadius:
                                    '8px',
                                background:
                                    '#3f1d1d',
                            }}
                        >
                            🔴 <strong>
                                Marché EUR/USD
                                fermé
                            </strong>

                            <div
                                style={{
                                    marginTop:
                                        '6px',
                                    fontSize:
                                        '13px',
                                }}
                            >
                                {marketOpenMessage ||
                                    'Deriv indique que le marché est actuellement fermé.'}
                            </div>

                            <div
                                style={{
                                    marginTop:
                                        '8px',
                                    fontSize:
                                        '12px',
                                }}
                            >
                                🔄 Nouvelle
                                vérification
                                automatique
                                toutes les
                                60 secondes.
                            </div>
                        </div>
                    )}

                    {!marketClosed &&
                        connection ===
                            'connected' && (
                            <div
                                style={{
                                    marginTop:
                                        '6px',
                                    fontSize:
                                        '13px',
                                }}
                            >
                                🟢 Flux
                                EUR/USD
                                actif.
                            </div>
                        )}
                </div>

                <section
                    style={{
                        background:
                            '#111827',
                        borderRadius:
                            '12px',
                        padding:
                            '16px',
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
                                '24px',
                            fontWeight:
                                'bold',
                        }}
                    >
                        {balance !==
                        null
                            ? `${balance.toFixed(
                                  2
                              )} USD`
                            : '—'}
                    </div>

                    <div
                        style={{
                            marginTop:
                                '6px',
                        }}
                    >
                        Compte :{' '}
                        {loginId ||
                            '—'}
                    </div>

                    <div
                        style={{
                            marginTop:
                                '8px',
                            fontSize:
                                '13px',
                        }}
                    >
                        {balance !==
                        null
                            ? '🟢 Solde reçu depuis Deriv'
                            : '🟡 Solde en attente'}
                    </div>
                </section>

                <section
                    style={{
                        background:
                            '#111827',
                        borderRadius:
                            '12px',
                        padding:
                            '16px',
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
                        <span
                            style={{
                                fontSize:
                                    '25px',
                                fontWeight:
                                    'bold',
                            }}
                        >
                            {price !==
                            null
                                ? price.toFixed(
                                      5
                                  )
                                : '—'}
                        </span>
                    </p>

                    <p>
                        <strong>
                            Dernier
                            chiffre
                        </strong>
                        <br />
                        <span
                            style={{
                                fontSize:
                                    '25px',
                                fontWeight:
                                    'bold',
                            }}
                        >
                            {lastDigit}
                        </span>
                    </p>
                </section>

                <section
                    style={{
                        background:
                            '#111827',
                        borderRadius:
                            '12px',
                        padding:
                            '16px',
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
                        {
                            priceHistory.length
                        }
                        /{HISTORY_SIZE}
                    </p>

                    <p>
                        {phaseOneComplete
                            ? '🟢 Historique suffisamment rempli'
                            : '🧠 Collecte de données…'}
                    </p>
                </section>

                <section
                    style={{
                        background:
                            '#111827',
                        borderRadius:
                            '12px',
                        padding:
                            '16px',
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
                            Direction
                            actuelle
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
                            padding:
                                '10px',
                            borderRadius:
                                '8px',
                            background:
                                '#1e293b',
                            fontSize:
                                '13px',
                        }}
                    >
                        ℹ️ L'analyse
                        utilise les
                        dernières
                        directions du
                        marché pour
                        produire une
                        indication
                        UP/DOWN.
                    </div>
                </section>

                <section
                    style={{
                        background:
                            '#111827',
                        borderRadius:
                            '12px',
                        padding:
                            '16px',
                        marginBottom:
                            '12px',
                    }}
                >
                    <h2>
                        🎮 Test Demo
                    </h2>

                    <p>
                        Le bouton
                        démarre le test
                        de la stratégie
                        avec les ticks
                        EUR/USD en mode
                        virtuel.
                    </p>

                    <div
                        style={{
                            display:
                                'flex',
                            gap:
                                '8px',
                            flexWrap:
                                'wrap',
                        }}
                    >
                        {!paperRunning ? (
                            <button
                                onClick={
                                    startPaperTest
                                }
                                disabled={
                                    marketClosed ||
                                    observations <
                                        4 ||
                                    paperResult.total >=
                                        PAPER_TEST_LIMIT
                                }
                                style={{
                                    padding:
                                        '12px 16px',
                                    border:
                                        'none',
                                    borderRadius:
                                        '8px',
                                    cursor:
                                        'pointer',
                                    fontWeight:
                                        'bold',
                                }}
                            >
                                ▶️ TESTER
                                SUR
                                COMPTE
                                DÉMO
                            </button>
                        ) : (
                            <button
                                onClick={
                                    stopPaperTest
                                }
                                style={{
                                    padding:
                                        '12px 16px',
                                    border:
                                        'none',
                                    borderRadius:
                                        '8px',
                                    cursor:
                                        'pointer',
                                    fontWeight:
                                        'bold',
                                }}
                            >
                                ⏹️ ARRÊTER
                            </button>
                        )}

                        <button
                            onClick={
                                resetPaperTest
                            }
                            style={{
                                padding:
                                    '12px 16px',
                                border:
                                    'none',
                                borderRadius:
                                    '8px',
                                cursor:
                                    'pointer',
                            }}
                        >
                            🔄 Réinitialiser
                        </button>
                    </div>

                    <div
                        style={{
                            marginTop:
                                '12px',
                            padding:
                                '10px',
                            borderRadius:
                                '8px',
                            background:
                                '#1e293b',
                            fontSize:
                                '13px',
                        }}
                    >
                        {proposalStatus ||
                            '🛡️ Aucun ordre financier.'}
                    </div>
                </section>

                <section
                    style={{
                        background:
                            '#111827',
                        borderRadius:
                            '12px',
                        padding:
                            '16px',
                        marginBottom:
                            '12px',
                    }}
                >
                    <h2>
                        🛡️ SÉCURITÉ
                    </h2>

                    <p>
                        Cette V4.11.2
                        n'envoie aucun
                        ordre BUY/SELL
                        à Deriv.
                    </p>

                    <p>
                        Les résultats
                        restent
                        virtuels.
                    </p>
                </section>

                <section
                    style={{
                        background:
                            '#111827',
                        borderRadius:
                            '12px',
                        padding:
                            '16px',
                        marginBottom:
                            '12px',
                    }}
                >
                    <h2>
                        🧪 Phase 2 —
                        Paper Trading
                    </h2>

                    <div
                        style={{
                            display:
                                'grid',
                            gridTemplateColumns:
                                'repeat(auto-fit, minmax(130px, 1fr))',
                            gap:
                                '10px',
                        }}
                    >
                        <div>
                            <strong>
                                Tests
                            </strong>
                            <br />
                            {
                                paperResult.total
                            }
                            /
                            {
                                PAPER_TEST_LIMIT
                            }
                        </div>

                        <div>
                            <strong>
                                Gains
                            </strong>
                            <br />
                            {
                                paperResult.wins
                            }
                        </div>

                        <div>
                            <strong>
                                Pertes
                            </strong>
                            <br />
                            {
                                paperResult.losses
                            }
                        </div>

                        <div>
                            <strong>
                                Taux gain
                            </strong>
                            <br />
                            {winRate.toFixed(
                                2
                            )}
                            %
                        </div>

                        <div>
                            <strong>
                                Taux perte
                            </strong>
                            <br />
                            {lossRate.toFixed(
                                2
                            )}
                            %
                        </div>

                        <div>
                            <strong>
                                Résultat
                                virtuel
                            </strong>
                            <br />
                            {paperResult.pnl >=
                            0
                                ? '+'
                                : ''}
                            {
                                paperResult.pnl
                            }
                        </div>
                    </div>

                    <p
                        style={{
                            marginTop:
                                '12px',
                        }}
                    >
                        +1 prédiction
                        correcte / -1
                        prédiction
                        incorrecte
                    </p>
                </section>

                <section
                    style={{
                        background:
                            '#111827',
                        borderRadius:
                            '12px',
                        padding:
                            '16px',
                        marginBottom:
                            '12px',
                    }}
                >
                    <h2>
                        📦 Blocs de 100
                    </h2>

                    <p>
                        Blocs terminés :{' '}
                        {
                            blocksCompleted
                        }
                    </p>

                    <p>
                        Bloc actuel :{' '}
                        {
                            currentBlockProgress
                        }
                        /100
                    </p>

                    <p>
                        {paperResult.total ===
                        0
                            ? '🧠 Collecte de données…'
                            : paperResult.total >=
                              PAPER_TEST_LIMIT
                            ? '🏁 Test de 1000 prédictions terminé'
                            : '🟢 Paper Test en cours / prêt'}
                    </p>
                </section>

                <section
                    style={{
                        background:
                            '#172033',
                        borderRadius:
                            '12px',
                        padding:
                            '16px',
                        marginBottom:
                            '12px',
                    }}
                >
                    <h2>
                        🛡️ MODE TEST
                        UNIQUEMENT
                    </h2>

                    <p>
                        ❌ Aucun trade
                        automatique réel
                        ou Demo n'est
                        envoyé.
                    </p>

                    <p>
                        Le bouton
                        « Tester sur
                        compte Demo »
                        démarre le
                        paper test avec
                        les données
                        réelles du
                        marché, mais
                        sans ordre
                        financier.
                    </p>
                </section>

                <div
                    style={{
                        textAlign:
                            'center',
                        padding:
                            '12px',
                        fontSize:
                            '13px',
                        opacity:
                            0.8,
                    }}
                >
                    ↕️ Fais glisser
                    l'écran pour
                    voir toutes les
                    informations
                </div>
            </div>
        </div>
    );
};

export default observer(
    R75TickMonitor
);

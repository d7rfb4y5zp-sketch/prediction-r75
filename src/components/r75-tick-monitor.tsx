import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { api_base } from '../external/bot-skeleton/services/api/api-base';

const MARKET_SYMBOL = 'frxEURUSD';
const MARKET_NAME = 'EUR/USD';

const HISTORY_SIZE = 500;
const PAPER_TEST_LIMIT = 1000;
const BLOCK_SIZE = 100;
const ANALYSIS_WINDOW = 40;

const TICK_REQUEST_ID = 4124;
const BALANCE_REQUEST_ID = 4125;

type Direction = 'UP' | 'DOWN' | 'FLAT';

type ConnectionState =
    | 'connecting'
    | 'connected'
    | 'waiting'
    | 'error';

type Tick = {
    quote: number;
    epoch?: number;
    symbol?: string;
    pip_size?: number;
};

type PaperResult = {
    wins: number;
    losses: number;
    total: number;
    pnl: number;
};

type Message = {
    msg_type?: string;

    tick?: Tick;

    balance?: {
        balance?: number;
        currency?: string;
        loginid?: string;
    };

    error?: {
        code?: string;
        message?: string;
    };

    echo_req?: {
        ticks?: string;
        subscribe?: number;
        req_id?: number;
    };

    subscription?: {
        id?: string;
    };
};

/* =========================================================
   OUTILS
========================================================= */

function tryParseJson(value: unknown): unknown {
    if (typeof value !== 'string') {
        return value;
    }

    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function normalizeDerivMessage(
    input: unknown
): Message | null {
    let value: any = tryParseJson(input);

    /*
     * api_base peut envoyer :
     *
     * {
     *   name: "message",
     *   data: {
     *      msg_type: "tick",
     *      tick: {...}
     *   }
     * }
     */
    if (
        value &&
        typeof value === 'object' &&
        'data' in value
    ) {
        value = tryParseJson(value.data);
    }

    if (
        !value ||
        typeof value !== 'object'
    ) {
        return null;
    }

    return value as Message;
}

/* =========================================================
   DIRECTION
========================================================= */

function getDirection(
    current: number,
    previous: number | null
): Direction {
    if (
        previous === null ||
        !Number.isFinite(current)
    ) {
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

/* =========================================================
   DERNIER CHIFFRE
========================================================= */

function getLastDigit(
    quote: number,
    pipSize?: number
): number {
    if (!Number.isFinite(quote)) {
        return 0;
    }

    const decimals =
        Number.isFinite(pipSize) &&
        Number(pipSize) >= 0
            ? Number(pipSize)
            : 5;

    const factor =
        10 ** decimals;

    const scaled =
        Math.round(
            quote * factor
        );

    return (
        Math.abs(scaled) % 10
    );
}

/* =========================================================
   PRÉDICTION V4.13
   TRANSITIONS + MOMENTUM RÉCENT
========================================================= */

function calculatePrediction(
    history: number[]
): {
    prediction: Direction;
    strength: number;
} {
    if (history.length < 6) {
        return {
            prediction: 'FLAT',
            strength: 0,
        };
    }

    /*
     * On analyse les derniers mouvements.
     */
    const sample = history.slice(
        -(ANALYSIS_WINDOW + 1)
    );

    const directions: Direction[] = [];

    for (
        let i = 1;
        i < sample.length;
        i += 1
    ) {
        directions.push(
            getDirection(
                sample[i],
                sample[i - 1]
            )
        );
    }

    /*
     * Les mouvements FLAT sont retirés
     * de la matrice de transition.
     */
    const cleanDirections =
        directions.filter(
            direction =>
                direction === 'UP' ||
                direction === 'DOWN'
        );

    if (
        cleanDirections.length < 5
    ) {
        return {
            prediction: 'FLAT',
            strength: 0,
        };
    }

    /* =====================================================
       MATRICE DES TRANSITIONS
    ===================================================== */

    let upAfterUp = 0;
    let downAfterUp = 0;

    let upAfterDown = 0;
    let downAfterDown = 0;

    for (
        let i = 1;
        i < cleanDirections.length;
        i += 1
    ) {
        const previous =
            cleanDirections[i - 1];

        const current =
            cleanDirections[i];

        if (
            previous === 'UP' &&
            current === 'UP'
        ) {
            upAfterUp += 1;
        }

        if (
            previous === 'UP' &&
            current === 'DOWN'
        ) {
            downAfterUp += 1;
        }

        if (
            previous === 'DOWN' &&
            current === 'UP'
        ) {
            upAfterDown += 1;
        }

        if (
            previous === 'DOWN' &&
            current === 'DOWN'
        ) {
            downAfterDown += 1;
        }
    }

    /* =====================================================
       DERNIÈRE DIRECTION
    ===================================================== */

    const lastDirection =
        cleanDirections[
            cleanDirections.length - 1
        ];

    let continuationScore = 0;
    let reversalScore = 0;

    if (
        lastDirection === 'UP'
    ) {
        continuationScore =
            upAfterUp;

        reversalScore =
            downAfterUp;
    } else {
        continuationScore =
            downAfterDown;

        reversalScore =
            upAfterDown;
    }

    /* =====================================================
       MOMENTUM RÉCENT
    ===================================================== */

    let recentUp = 0;
    let recentDown = 0;

    const recentWindow =
        cleanDirections.slice(-8);

    recentWindow.forEach(
        (direction, index) => {
            /*
             * Le mouvement le plus récent
             * reçoit le poids le plus élevé.
             */
            const weight =
                index + 1;

            if (
                direction === 'UP'
            ) {
                recentUp += weight;
            }

            if (
                direction === 'DOWN'
            ) {
                recentDown += weight;
            }
        }
    );

    /* =====================================================
       SCORE GLOBAL
    ===================================================== */

    let upScore = 0;
    let downScore = 0;

    /*
     * Transition.
     */
    if (
        lastDirection === 'UP'
    ) {
        upScore +=
            continuationScore * 1.4;

        downScore +=
            reversalScore * 1.4;
    } else {
        downScore +=
            continuationScore * 1.4;

        upScore +=
            reversalScore * 1.4;
    }

    /*
     * Momentum récent.
     */
    upScore +=
        recentUp * 0.8;

    downScore +=
        recentDown * 0.8;

    /* =====================================================
       CONFIANCE
    ===================================================== */

    const totalScore =
        upScore + downScore;

    if (
        totalScore <= 0 ||
        !Number.isFinite(
            totalScore
        )
    ) {
        return {
            prediction: 'FLAT',
            strength: 0,
        };
    }

    const difference =
        Math.abs(
            upScore - downScore
        );

    const confidence =
        Math.round(
            (difference /
                totalScore) *
                100
        );

    /*
     * Pas de signal si l'écart
     * entre les deux directions
     * est trop faible.
     */
    if (
        confidence < 12
    ) {
        return {
            prediction: 'FLAT',
            strength: confidence,
        };
    }

    if (
        upScore > downScore
    ) {
        return {
            prediction: 'UP',
            strength: Math.min(
                95,
                confidence
            ),
        };
    }

    if (
        downScore > upScore
    ) {
        return {
            prediction: 'DOWN',
            strength: Math.min(
                95,
                confidence
            ),
        };
    }

    return {
        prediction: 'FLAT',
        strength: 0,
    };
}

/* =========================================================
   COMPOSANT
========================================================= */

const R75TickMonitor: React.FC = () => {
    const [connection, setConnection] =
        useState<ConnectionState>(
            'connecting'
        );

    const [price, setPrice] =
        useState<number | null>(
            null
        );

    const [lastDigit, setLastDigit] =
        useState<number | null>(
            null
        );

    const [
        currentDirection,
        setCurrentDirection,
    ] = useState<Direction>(
        'FLAT'
    );

    const [prediction, setPrediction] =
        useState<Direction>(
            'FLAT'
        );

    const [strength, setStrength] =
        useState(0);

    const [tickCount, setTickCount] =
        useState(0);

    const [balance, setBalance] =
        useState<number | null>(
            null
        );

    const [loginId, setLoginId] =
        useState('—');

    const [paperRunning, setPaperRunning] =
        useState(false);

    const [paperResult, setPaperResult] =
        useState<PaperResult>({
            wins: 0,
            losses: 0,
            total: 0,
            pnl: 0,
        });

    const [
        lastPaperOutcome,
        setLastPaperOutcome,
    ] = useState<
        'WIN' | 'LOSS' | null
    >(null);

    const [
        proposalStatus,
        setProposalStatus,
    ] = useState(
        'Aucune proposition demandée'
    );

    /* =====================================================
       REFS
    ===================================================== */

    const previousPriceRef =
        useRef<number | null>(
            null
        );

    const historyRef =
        useRef<number[]>([]);

    const previousPredictionForPaperRef =
        useRef<Direction>(
            'FLAT'
        );

    const paperRunningRef =
        useRef(false);

    const paperResultRef =
        useRef<PaperResult>({
            wins: 0,
            losses: 0,
            total: 0,
            pnl: 0,
        });

    const unsubscribeRef =
        useRef<
            (() => void) | null
        >(null);

    /* =====================================================
       INITIALISATION API
    ===================================================== */

    const initialiseApi =
        useCallback(
            async () => {
                try {
                    if (!api_base.api) {
                        await api_base.init();
                    }

                    if (!api_base.api) {
                        setConnection(
                            'error'
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

                    return false;
                }
            },
            []
        );

    /* =====================================================
       BALANCE
    ===================================================== */

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

    /* =====================================================
       TRAITEMENT TICK
    ===================================================== */

    const processTick =
        useCallback(
            (tick: Tick) => {
                if (!tick) {
                    return;
                }

                /*
                 * FILTRE ABSOLU :
                 * seul EUR/USD est accepté.
                 */
                if (
                    String(
                        tick.symbol || ''
                    ) !==
                    MARKET_SYMBOL
                ) {
                    return;
                }

                const quote =
                    Number(
                        tick.quote
                    );

                if (
                    !Number.isFinite(
                        quote
                    )
                ) {
                    return;
                }

                const previousPrice =
                    previousPriceRef.current;

                /* =================================================
                   1. VALIDATION DU TICK PRÉCÉDENT
                ================================================= */

                if (
                    paperRunningRef.current &&
                    previousPrice !== null
                ) {
                    const previousPrediction =
                        previousPredictionForPaperRef.current;

                    if (
                        previousPrediction ===
                            'UP' ||
                        previousPrediction ===
                            'DOWN'
                    ) {
                        let win =
                            false;

                        if (
                            previousPrediction ===
                                'UP' &&
                            quote >
                                previousPrice
                        ) {
                            win =
                                true;
                        }

                        if (
                            previousPrediction ===
                                'DOWN' &&
                            quote <
                                previousPrice
                        ) {
                            win =
                                true;
                        }

                        const old =
                            paperResultRef.current;

                        const newTotal =
                            old.total +
                            1;

                        const newResult: PaperResult =
                            {
                                wins:
                                    old.wins +
                                    (win
                                        ? 1
                                        : 0),

                                losses:
                                    old.losses +
                                    (win
                                        ? 0
                                        : 1),

                                total:
                                    newTotal,

                                pnl:
                                    old.pnl +
                                    (win
                                        ? 1
                                        : -1),
                            };

                        paperResultRef.current =
                            newResult;

                        setPaperResult(
                            newResult
                        );

                        setLastPaperOutcome(
                            win
                                ? 'WIN'
                                : 'LOSS'
                        );

                        /*
                         * Arrêt exact à 1000.
                         */
                        if (
                            newTotal >=
                            PAPER_TEST_LIMIT
                        ) {
                            paperRunningRef.current =
                                false;

                            setPaperRunning(
                                false
                            );
                        }
                    }
                }

                /* =================================================
                   2. DIRECTION
                ================================================= */

                const direction =
                    getDirection(
                        quote,
                        previousPrice
                    );

                /* =================================================
                   3. HISTORIQUE
                ================================================= */

                const newHistory = [
                    ...historyRef.current,
                    quote,
                ].slice(
                    -HISTORY_SIZE
                );

                historyRef.current =
                    newHistory;

                /* =================================================
                   4. PRÉDICTION V4.13
                ================================================= */

                const analysis =
                    calculatePrediction(
                        newHistory
                    );

                const newPrediction =
                    analysis.prediction;

                /* =================================================
                   5. DERNIER CHIFFRE
                ================================================= */

                const digit =
                    getLastDigit(
                        quote,
                        tick.pip_size
                    );

                /* =================================================
                   6. UI
                ================================================= */

                previousPriceRef.current =
                    quote;

                setPrice(
                    quote
                );

                setLastDigit(
                    digit
                );

                setCurrentDirection(
                    direction
                );

                setPrediction(
                    newPrediction
                );

                setStrength(
                    analysis.strength
                );

                setTickCount(
                    value =>
                        value + 1
                );

                setConnection(
                    'connected'
                );

                /*
                 * Cette prédiction sera vérifiée
                 * avec le prochain tick.
                 */
                previousPredictionForPaperRef.current =
                    newPrediction;
            },
            []
        );

    /* =====================================================
       MESSAGE DERIV
    ===================================================== */

    const handleDerivMessage =
        useCallback(
            (input: unknown) => {
                const message =
                    normalizeDerivMessage(
                        input
                    );

                if (!message) {
                    return;
                }

                /* =================================================
                   ERREUR
                ================================================= */

                if (
                    message.error
                ) {
                    console.error(
                        'Erreur Deriv:',
                        message.error
                    );

                    const requestedSymbol =
                        String(
                            message
                                .echo_req
                                ?.ticks || ''
                        );

                    if (
                        requestedSymbol ===
                        MARKET_SYMBOL
                    ) {
                        setConnection(
                            'error'
                        );
                    }

                    return;
                }

                /* =================================================
                   BALANCE
                ================================================= */

                if (
                    message.msg_type ===
                        'balance' &&
                    message.balance
                ) {
                    const rawBalance =
                        Number(
                            message
                                .balance
                                .balance
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
                            .balance
                            .loginid;

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

                /* =================================================
                   TICK
                ================================================= */

                if (
                    message.msg_type ===
                        'tick' &&
                    message.tick
                ) {
                    /*
                     * IMPORTANT :
                     *
                     * 1HZ100V -> ignoré
                     * R_75 -> ignoré
                     * tout autre symbole -> ignoré
                     *
                     * SEUL frxEURUSD est traité.
                     */
                    if (
                        String(
                            message.tick
                                .symbol ||
                                ''
                        ) !==
                        MARKET_SYMBOL
                    ) {
                        return;
                    }

                    processTick(
                        message.tick
                    );
                }
            },
            [processTick]
        );

    /* =====================================================
       CONNEXION
    ===================================================== */

    useEffect(() => {
        let cancelled =
            false;

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

                    /*
                     * Abonnement EUR/USD.
                     */
                    api_base.api.send({
                        ticks:
                            MARKET_SYMBOL,
                        subscribe: 1,
                        req_id:
                            TICK_REQUEST_ID,
                    });

                    /*
                     * Balance.
                     */
                    requestBalance();

                    /*
                     * On attend un vrai tick EUR/USD.
                     */
                    setConnection(
                        'waiting'
                    );
                } catch (error) {
                    console.error(
                        'Erreur abonnement:',
                        error
                    );

                    setConnection(
                        'error'
                    );
                }
            };

        start();

        return () => {
            cancelled =
                true;

            if (
                unsubscribeRef.current
            ) {
                unsubscribeRef.current();

                unsubscribeRef.current =
                    null;
            }
        };
    }, [
        initialiseApi,
        handleDerivMessage,
        requestBalance,
    ]);

    /* =====================================================
       DÉMARRER PAPER TEST
    ===================================================== */

    const startPaperTest =
        useCallback(() => {
            /*
             * Nouveau test propre :
             * 0 -> 1000.
             */
            const reset: PaperResult =
                {
                    wins: 0,
                    losses: 0,
                    total: 0,
                    pnl: 0,
                };

            paperResultRef.current =
                reset;

            setPaperResult(
                reset
            );

            setLastPaperOutcome(
                null
            );

            /*
             * La prédiction actuellement
             * affichée devient la première
             * prédiction à tester.
             */
            previousPredictionForPaperRef.current =
                prediction;

            paperRunningRef.current =
                true;

            setPaperRunning(
                true
            );
        }, [prediction]);

    /* =====================================================
       ARRÊTER PAPER
    ===================================================== */

    const stopPaperTest =
        useCallback(() => {
            paperRunningRef.current =
                false;

            setPaperRunning(
                false
            );
        }, []);

    /* =====================================================
       PROPOSITION
    ===================================================== */

    const requestDemoProposal =
        useCallback(() => {
            if (
                prediction !== 'UP' &&
                prediction !== 'DOWN'
            ) {
                setProposalStatus(
                    '⚪ Pas de signal exploitable'
                );

                return;
            }

            const directionText =
                prediction === 'UP'
                    ? 'HAUSSE'
                    : 'BAISSE';

            /*
             * Aucun BUY.
             * Aucun SELL.
             */
            setProposalStatus(
                `🟡 Proposition ${directionText} — aucune transaction envoyée`
            );
        }, [prediction]);

    /* =====================================================
       STATISTIQUES
    ===================================================== */

    const winRate =
        useMemo(() => {
            if (
                paperResult.total ===
                0
            ) {
                return 0;
            }

            return (
                (paperResult.wins /
                    paperResult.total) *
                100
            );
        }, [paperResult]);

    /*
     * Bloc :
     *
     * 0    -> 1/10 • 0/100
     * 100  -> 1/10 • 100/100
     * 101  -> 2/10 • 1/100
     */
    const currentBlock =
        paperResult.total ===
        0
            ? 1
            : Math.min(
                  10,
                  Math.ceil(
                      paperResult.total /
                          BLOCK_SIZE
                  )
              );

    const blockProgress =
        paperResult.total ===
        0
            ? 0
            : paperResult.total %
                  BLOCK_SIZE ===
              0
              ? BLOCK_SIZE
              : paperResult.total %
                BLOCK_SIZE;

    /* =====================================================
       LABELS
    ===================================================== */

    const directionLabel =
        currentDirection ===
        'UP'
            ? 'HAUSSE'
            : currentDirection ===
                'DOWN'
              ? 'BAISSE'
              : 'STABLE';

    const predictionLabel =
        prediction ===
        'UP'
            ? 'HAUSSE'
            : prediction ===
                'DOWN'
              ? 'BAISSE'
              : 'STABLE';

    const connectionLabel =
        connection ===
        'connected'
            ? '🟢 Connecté — EUR/USD'
            : connection ===
                'waiting'
              ? '🟠 Connexion — attente EUR/USD…'
              : connection ===
                  'error'
                ? '🔴 Erreur EUR/USD'
                : '🟠 Connexion à Deriv…';

    /* =====================================================
       UI
    ===================================================== */

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
                overscrollBehaviorY:
                    'auto',
                touchAction:
                    'pan-y',
                background:
                    '#0f172a',
                color:
                    '#e5e7eb',
                padding:
                    '16px',
                paddingBottom:
                    '80px',
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
                {/* HEADER */}

                <div
                    style={{
                        marginBottom:
                            '14px',
                    }}
                >
                    <h1
                        style={{
                            margin: 0,
                            fontSize:
                                '22px',
                            fontWeight:
                                800,
                        }}
                    >
                        📈 Moniteur Forex{' '}
                        {MARKET_NAME} — V4.13
                    </h1>

                    <div
                        style={{
                            marginTop:
                                '6px',
                            color:
                                '#94a3b8',
                            fontSize:
                                '13px',
                        }}
                    >
                        Demo + Paper Trader +
                        Proposition
                    </div>
                </div>

                {/* CONNEXION */}

                <div
                    style={{
                        background:
                            '#111827',
                        border:
                            '1px solid #1f2937',
                        borderRadius:
                            '14px',
                        padding:
                            '12px 14px',
                        marginBottom:
                            '12px',
                    }}
                >
                    <div
                        style={{
                            fontSize:
                                '14px',
                            fontWeight:
                                700,
                        }}
                    >
                        {
                            connectionLabel
                        }
                    </div>

                    <div
                        style={{
                            marginTop:
                                '5px',
                            color:
                                '#64748b',
                            fontSize:
                                '12px',
                        }}
                    >
                        Flux strict :{' '}
                        {MARKET_SYMBOL}
                        {' • '}
                        {tickCount}{' '}
                        tick(s)
                    </div>
                </div>

                {/* PRIX */}

                <div
                    style={{
                        background:
                            '#111827',
                        border:
                            '1px solid #1f2937',
                        borderRadius:
                            '14px',
                        padding:
                            '18px',
                        marginBottom:
                            '12px',
                    }}
                >
                    <div
                        style={{
                            color:
                                '#94a3b8',
                            fontSize:
                                '12px',
                            marginBottom:
                                '6px',
                        }}
                    >
                        PRIX {MARKET_NAME}
                    </div>

                    <div
                        style={{
                            fontSize:
                                '32px',
                            fontWeight:
                                800,
                            letterSpacing:
                                '1px',
                        }}
                    >
                        {price !==
                        null
                            ? price.toFixed(
                                  5
                              )
                            : '—'}
                    </div>

                    <div
                        style={{
                            display:
                                'flex',
                            gap:
                                '10px',
                            marginTop:
                                '12px',
                            flexWrap:
                                'wrap',
                        }}
                    >
                        <div
                            style={{
                                background:
                                    '#1e293b',
                                padding:
                                    '8px 12px',
                                borderRadius:
                                    '10px',
                            }}
                        >
                            Dernier chiffre :
                            <strong>
                                {' '}
                                {lastDigit !==
                                null
                                    ? lastDigit
                                    : '—'}
                            </strong>
                        </div>

                        <div
                            style={{
                                background:
                                    '#1e293b',
                                padding:
                                    '8px 12px',
                                borderRadius:
                                    '10px',
                            }}
                        >
                            Direction :
                            <strong>
                                {' '}
                                {
                                    directionLabel
                                }
                            </strong>
                        </div>
                    </div>
                </div>

                {/* ANALYSE */}

                <div
                    style={{
                        display:
                            'grid',
                        gridTemplateColumns:
                            'repeat(auto-fit, minmax(150px, 1fr))',
                        gap:
                            '10px',
                        marginBottom:
                            '12px',
                    }}
                >
                    <div
                        style={{
                            background:
                                '#111827',
                            border:
                                '1px solid #1f2937',
                            borderRadius:
                                '14px',
                            padding:
                                '15px',
                        }}
                    >
                        <div
                            style={{
                                color:
                                    '#94a3b8',
                                fontSize:
                                    '12px',
                            }}
                        >
                            PRÉDICTION
                        </div>

                        <div
                            style={{
                                marginTop:
                                    '7px',
                                fontSize:
                                    '20px',
                                fontWeight:
                                    800,
                            }}
                        >
                            {prediction ===
                            'UP'
                                ? '🟢 HAUSSE'
                                : prediction ===
                                    'DOWN'
                                  ? '🔴 BAISSE'
                                  : '⚪ STABLE'}
                        </div>
                    </div>

                    <div
                        style={{
                            background:
                                '#111827',
                            border:
                                '1px solid #1f2937',
                            borderRadius:
                                '14px',
                            padding:
                                '15px',
                        }}
                    >
                        <div
                            style={{
                                color:
                                    '#94a3b8',
                                fontSize:
                                    '12px',
                            }}
                        >
                            FORCE
                        </div>

                        <div
                            style={{
                                marginTop:
                                    '7px',
                                fontSize:
                                    '20px',
                                fontWeight:
                                    800,
                            }}
                        >
                            {strength}%
                        </div>
                    </div>
                </div>

                {/* PAPER */}

                <div
                    style={{
                        background:
                            '#111827',
                        border:
                            '1px solid #1f2937',
                        borderRadius:
                            '14px',
                        padding:
                            '16px',
                        marginBottom:
                            '12px',
                    }}
                >
                    <div
                        style={{
                            display:
                                'flex',
                            justifyContent:
                                'space-between',
                            alignItems:
                                'center',
                            gap:
                                '10px',
                            flexWrap:
                                'wrap',
                        }}
                    >
                        <div>
                            <div
                                style={{
                                    fontSize:
                                        '16px',
                                    fontWeight:
                                        800,
                                }}
                            >
                                🧪 PAPER TEST
                            </div>

                            <div
                                style={{
                                    color:
                                        '#94a3b8',
                                    fontSize:
                                        '12px',
                                    marginTop:
                                        '4px',
                                }}
                            >
                                1000 tests •
                                blocs de 100 •
                                +1 / -1 virtuel
                            </div>
                        </div>

                        <div
                            style={{
                                background:
                                    paperRunning
                                        ? '#422006'
                                        : '#1e293b',
                                padding:
                                    '7px 10px',
                                borderRadius:
                                    '9px',
                                fontSize:
                                    '12px',
                            }}
                        >
                            {paperRunning
                                ? '🟡 EN COURS'
                                : paperResult.total >=
                                    PAPER_TEST_LIMIT
                                  ? '✅ TERMINÉ'
                                  : '⚪ PRÊT'}
                        </div>
                    </div>

                    <div
                        style={{
                            marginTop:
                                '16px',
                            display:
                                'grid',
                            gridTemplateColumns:
                                'repeat(2, 1fr)',
                            gap:
                                '10px',
                        }}
                    >
                        <div
                            style={{
                                background:
                                    '#0f172a',
                                borderRadius:
                                    '10px',
                                padding:
                                    '12px',
                            }}
                        >
                            <div
                                style={{
                                    color:
                                        '#64748b',
                                    fontSize:
                                        '11px',
                                }}
                            >
                                TESTS
                            </div>

                            <div
                                style={{
                                    fontSize:
                                        '20px',
                                    fontWeight:
                                        800,
                                }}
                            >
                                {
                                    paperResult.total
                                }
                                /1000
                            </div>
                        </div>

                        <div
                            style={{
                                background:
                                    '#0f172a',
                                borderRadius:
                                    '10px',
                                padding:
                                    '12px',
                            }}
                        >
                            <div
                                style={{
                                    color:
                                        '#64748b',
                                    fontSize:
                                        '11px',
                                }}
                            >
                                TAUX
                            </div>

                            <div
                                style={{
                                    fontSize:
                                        '20px',
                                    fontWeight:
                                        800,
                                }}
                            >
                                {winRate.toFixed(
                                    2
                                )}
                                %
                            </div>
                        </div>

                        <div
                            style={{
                                background:
                                    '#0f172a',
                                borderRadius:
                                    '10px',
                                padding:
                                    '12px',
                            }}
                        >
                            <div
                                style={{
                                    color:
                                        '#64748b',
                                    fontSize:
                                        '11px',
                                }}
                            >
                                GAINS
                            </div>

                            <div
                                style={{
                                    fontSize:
                                        '20px',
                                    fontWeight:
                                        800,
                                }}
                            >
                                {
                                    paperResult.wins
                                }
                            </div>
                        </div>

                        <div
                            style={{
                                background:
                                    '#0f172a',
                                borderRadius:
                                    '10px',
                                padding:
                                    '12px',
                            }}
                        >
                            <div
                                style={{
                                    color:
                                        '#64748b',
                                    fontSize:
                                        '11px',
                                }}
                            >
                                PERTES
                            </div>

                            <div
                                style={{
                                    fontSize:
                                        '20px',
                                    fontWeight:
                                        800,
                                }}
                            >
                                {
                                    paperResult.losses
                                }
                            </div>
                        </div>
                    </div>

                    <div
                        style={{
                            marginTop:
                                '10px',
                            background:
                                '#0f172a',
                            borderRadius:
                                '10px',
                            padding:
                                '13px',
                            textAlign:
                                'center',
                        }}
                    >
                        <div
                            style={{
                                color:
                                    '#64748b',
                                fontSize:
                                    '11px',
                            }}
                        >
                            P/L VIRTUEL
                        </div>

                        <div
                            style={{
                                marginTop:
                                    '4px',
                                fontSize:
                                    '24px',
                                fontWeight:
                                    900,
                            }}
                        >
                            {paperResult.pnl >=
                            0
                                ? '+'
                                : ''}
                            {
                                paperResult.pnl
                            }
                        </div>
                    </div>

                    <div
                        style={{
                            marginTop:
                                '10px',
                            color:
                                '#94a3b8',
                            fontSize:
                                '12px',
                            textAlign:
                                'center',
                        }}
                    >
                        Bloc actuel :{' '}
                        {currentBlock}
                        /10
                        {' • '}
                        {blockProgress}
                        /100
                    </div>

                    {lastPaperOutcome && (
                        <div
                            style={{
                                marginTop:
                                    '8px',
                                textAlign:
                                    'center',
                                fontWeight:
                                    700,
                                fontSize:
                                    '13px',
                            }}
                        >
                            Dernier résultat :{' '}
                            {lastPaperOutcome ===
                            'WIN'
                                ? '🟢 GAIN +1'
                                : '🔴 PERTE -1'}
                        </div>
                    )}

                    <div
                        style={{
                            display:
                                'flex',
                            gap:
                                '8px',
                            marginTop:
                                '14px',
                        }}
                    >
                        <button
                            type="button"
                            onClick={
                                startPaperTest
                            }
                            disabled={
                                paperRunning
                            }
                            style={{
                                flex: 1,
                                border:
                                    'none',
                                borderRadius:
                                    '10px',
                                padding:
                                    '12px',
                                background:
                                    paperRunning
                                        ? '#334155'
                                        : '#2563eb',
                                color:
                                    '#fff',
                                fontWeight:
                                    800,
                                cursor:
                                    paperRunning
                                        ? 'not-allowed'
                                        : 'pointer',
                            }}
                        >
                            ▶️ Démarrer
                        </button>

                        <button
                            type="button"
                            onClick={
                                stopPaperTest
                            }
                            disabled={
                                !paperRunning
                            }
                            style={{
                                flex: 1,
                                border:
                                    'none',
                                borderRadius:
                                    '10px',
                                padding:
                                    '12px',
                                background:
                                    !paperRunning
                                        ? '#334155'
                                        : '#dc2626',
                                color:
                                    '#fff',
                                fontWeight:
                                    800,
                                cursor:
                                    !paperRunning
                                        ? 'not-allowed'
                                        : 'pointer',
                            }}
                        >
                            ⏹️ Arrêter
                        </button>
                    </div>
                </div>

                {/* BALANCE */}

                <div
                    style={{
                        background:
                            '#111827',
                        border:
                            '1px solid #1f2937',
                        borderRadius:
                            '14px',
                        padding:
                            '16px',
                        marginBottom:
                            '12px',
                    }}
                >
                    <div
                        style={{
                            fontSize:
                                '16px',
                            fontWeight:
                                800,
                            marginBottom:
                                '10px',
                        }}
                    >
                        💰 COMPTE DÉMO
                    </div>

                    <div
                        style={{
                            fontSize:
                                '28px',
                            fontWeight:
                                900,
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
                                '7px',
                            color:
                                '#64748b',
                            fontSize:
                                '12px',
                        }}
                    >
                        Compte :{' '}
                        {loginId}
                    </div>
                </div>

                {/* PROPOSITION */}

                <div
                    style={{
                        background:
                            '#111827',
                        border:
                            '1px solid #1f2937',
                        borderRadius:
                            '14px',
                        padding:
                            '16px',
                        marginBottom:
                            '12px',
                    }}
                >
                    <div
                        style={{
                            fontSize:
                                '16px',
                            fontWeight:
                                800,
                        }}
                    >
                        🧾 PROPOSITION DÉMO
                    </div>

                    <div
                        style={{
                            color:
                                '#94a3b8',
                            fontSize:
                                '12px',
                            marginTop:
                                '5px',
                        }}
                    >
                        Proposition uniquement.
                        Aucun BUY/SELL
                        n'est envoyé.
                    </div>

                    <div
                        style={{
                            marginTop:
                                '12px',
                            background:
                                '#0f172a',
                            borderRadius:
                                '10px',
                            padding:
                                '12px',
                            fontSize:
                                '13px',
                        }}
                    >
                        Signal actuel :{' '}
                        <strong>
                            {
                                predictionLabel
                            }
                        </strong>
                    </div>

                    <button
                        type="button"
                        onClick={
                            requestDemoProposal
                        }
                        style={{
                            width:
                                '100%',
                            marginTop:
                                '10px',
                            border:
                                'none',
                            borderRadius:
                                '10px',
                            padding:
                                '12px',
                            background:
                                '#475569',
                            color:
                                '#fff',
                            fontWeight:
                                800,
                            cursor:
                                'pointer',
                        }}
                    >
                        📋 Voir la proposition
                    </button>

                    <div
                        style={{
                            marginTop:
                                '10px',
                            color:
                                '#cbd5e1',
                            fontSize:
                                '12px',
                            textAlign:
                                'center',
                        }}
                    >
                        {
                            proposalStatus
                        }
                    </div>
                </div>

                {/* FOOTER */}

                <div
                    style={{
                        textAlign:
                            'center',
                        color:
                            '#475569',
                        fontSize:
                            '11px',
                        padding:
                            '10px 0 20px',
                    }}
                >
                    V4.13 • Analyse
                    EUR/USD • Paper uniquement
                    • Aucun trade réel
                </div>
            </div>
        </div>
    );
};

export default R75TickMonitor;

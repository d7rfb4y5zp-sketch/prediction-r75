import React, { useEffect, useRef, useState } from 'react';
import { api_base } from '../external/bot-skeleton';

const MARKET_SYMBOL = 'frxEURUSD';
const MARKET_NAME = 'EUR/USD';

const HISTORY_SIZE = 500;
const PAPER_TEST_LIMIT = 1000;
const BLOCK_SIZE = 100;
const ANALYSIS_WINDOW = 20;

type Direction = 'UP' | 'DOWN';

type Tick = {
    symbol?: string;
    quote?: number;
    epoch?: number;
};

type Stats = {
    tests: number;
    wins: number;
    losses: number;
    virtualProfit: number;
};

type BalanceInfo = {
    balance: number;
    currency: string;
    loginid?: string;
};

type TestMode =
    | 'idle'
    | 'testing'
    | 'stopped'
    | 'done';

const getDirection = (
    previous: number,
    current: number
): Direction => {
    return current >= previous ? 'UP' : 'DOWN';
};

const directionLabel = (
    direction: Direction | null
) => {
    if (direction === 'UP') {
        return '🟢 HAUSSE';
    }

    if (direction === 'DOWN') {
        return '🔴 BAISSE';
    }

    return '—';
};

export default function R75TickMonitor() {
    const [connected, setConnected] =
        useState(false);

    const [connectionError, setConnectionError] =
        useState('');

    const [price, setPrice] =
        useState<number | null>(null);

    const [lastDigit, setLastDigit] =
        useState<number | null>(null);

    const [historyCount, setHistoryCount] =
        useState(0);

    const [phase, setPhase] = useState<
        'learning' | 'testing' | 'done'
    >('learning');

    const [testMode, setTestMode] =
        useState<TestMode>('idle');

    const [currentDirection, setCurrentDirection] =
        useState<Direction | null>(null);

    const [prediction, setPrediction] =
        useState<Direction | null>(null);

    const [predictionStrength, setPredictionStrength] =
        useState(0);

    const [observations, setObservations] =
        useState(0);

    const [stats, setStats] =
        useState<Stats>({
            tests: 0,
            wins: 0,
            losses: 0,
            virtualProfit: 0,
        });

    const [blocks, setBlocks] =
        useState<number[]>([]);

    const [currentBlockWins, setCurrentBlockWins] =
        useState(0);

    const [currentBlockTests, setCurrentBlockTests] =
        useState(0);

    const [balanceInfo, setBalanceInfo] =
        useState<BalanceInfo | null>(null);

    const [balanceError, setBalanceError] =
        useState('');

    const [balanceReceived, setBalanceReceived] =
        useState(false);

    const previousPriceRef =
        useRef<number | null>(null);

    const priceHistoryRef =
        useRef<number[]>([]);

    const directionHistoryRef =
        useRef<Direction[]>([]);

    const predictionRef =
        useRef<Direction | null>(null);

    const testsRef =
        useRef(0);

    const winsRef =
        useRef(0);

    const lossesRef =
        useRef(0);

    const virtualProfitRef =
        useRef(0);

    const blockWinsRef =
        useRef(0);

    const blockTestsRef =
        useRef(0);

    const subscribedRef =
        useRef(false);

    const balanceRequestedRef =
        useRef(false);

    const testModeRef =
        useRef<TestMode>('idle');

    /*
     * =========================================================
     * ANALYSE
     * =========================================================
     */

    const calculatePrediction = () => {
        const history =
            directionHistoryRef.current;

        const recent =
            history.slice(
                -ANALYSIS_WINDOW
            );

        if (recent.length < 5) {
            return {
                direction:
                    null as Direction | null,
                strength: 0,
                observations:
                    recent.length,
            };
        }

        let up = 0;
        let down = 0;

        recent.forEach(
            direction => {
                if (
                    direction ===
                    'UP'
                ) {
                    up += 1;
                } else {
                    down += 1;
                }
            }
        );

        const total =
            up + down;

        if (total === 0) {
            return {
                direction:
                    null as Direction | null,
                strength: 0,
                observations: 0,
            };
        }

        const upPercent =
            (up / total) * 100;

        const downPercent =
            (down / total) * 100;

        if (up >= down) {
            return {
                direction:
                    'UP' as Direction,
                strength:
                    upPercent,
                observations:
                    total,
            };
        }

        return {
            direction:
                'DOWN' as Direction,
            strength:
                downPercent,
            observations:
                total,
        };
    };

    /*
     * =========================================================
     * BOUTON : DÉMARRER LE TEST DEMO
     * =========================================================
     */

    const startDemoTest = () => {
        if (!connected) {
            setConnectionError(
                'Le marché EUR/USD n’est pas encore connecté.'
            );

            return;
        }

        if (
            historyCount <
            HISTORY_SIZE
        ) {
            setConnectionError(
                'Attends que les 500 ticks soient collectés avant de commencer le test.'
            );

            return;
        }

        if (
            testModeRef.current ===
            'testing'
        ) {
            return;
        }

        /*
         * IMPORTANT :
         *
         * Cette version ne fait PAS de requête buy.
         *
         * Elle démarre uniquement
         * le paper trading.
         */

        testModeRef.current =
            'testing';

        setTestMode(
            'testing'
        );

        setPhase('testing');

        setConnectionError('');

        /*
         * Si aucun test n'a encore
         * commencé, on prépare
         * la première prédiction.
         */

        if (
            predictionRef.current ===
            null
        ) {
            const result =
                calculatePrediction();

            predictionRef.current =
                result.direction;

            setPrediction(
                result.direction
            );

            setPredictionStrength(
                result.strength
            );

            setObservations(
                result.observations
            );
        }
    };

    /*
     * =========================================================
     * BOUTON : ARRÊTER LE TEST
     * =========================================================
     */

    const stopDemoTest = () => {
        testModeRef.current =
            'stopped';

        setTestMode(
            'stopped'
        );

        /*
         * On conserve les statistiques.
         */

        setPrediction(
            predictionRef.current
        );
    };

    /*
     * =========================================================
     * RESET TEST
     * =========================================================
     */

    const resetPaperTest = () => {
        testsRef.current = 0;
        winsRef.current = 0;
        lossesRef.current = 0;
        virtualProfitRef.current = 0;

        blockWinsRef.current = 0;
        blockTestsRef.current = 0;

        predictionRef.current =
            null;

        setStats({
            tests: 0,
            wins: 0,
            losses: 0,
            virtualProfit: 0,
        });

        setBlocks([]);

        setCurrentBlockWins(0);
        setCurrentBlockTests(0);

        const result =
            calculatePrediction();

        predictionRef.current =
            result.direction;

        setPrediction(
            result.direction
        );

        setPredictionStrength(
            result.strength
        );

        setObservations(
            result.observations
        );

        testModeRef.current =
            'idle';

        setTestMode('idle');

        setPhase('testing');
    };

    /*
     * =========================================================
     * DEMANDE DU SOLDE
     * =========================================================
     */

    const requestCurrentBalance = () => {
        if (!api_base?.api) {
            return;
        }

        if (
            balanceRequestedRef.current
        ) {
            return;
        }

        balanceRequestedRef.current =
            true;

        try {
            api_base.api.send({
                balance: 1,
                req_id: 4901,
            });
        } catch (error: any) {
            balanceRequestedRef.current =
                false;

            setBalanceError(
                error?.message ||
                    'Impossible de demander le solde Demo.'
            );
        }
    };

    /*
     * =========================================================
     * TRAITEMENT SOLDE
     * =========================================================
     */

    const processBalance = (
        data: any
    ) => {
        if (!data?.balance) {
            return;
        }

        const rawBalance =
            data.balance.balance;

        const currency =
            data.balance.currency ||
            'USD';

        const loginid =
            data.balance.loginid;

        if (
            typeof rawBalance !==
                'number' ||
            !Number.isFinite(
                rawBalance
            )
        ) {
            return;
        }

        setBalanceInfo({
            balance:
                rawBalance,
            currency,
            loginid,
        });

        setBalanceReceived(
            true
        );

        setBalanceError('');
    };

    /*
     * =========================================================
     * TRAITEMENT TICK
     * =========================================================
     */

    const processTick = (
        tick: Tick
    ) => {
        if (
            tick.symbol !==
            MARKET_SYMBOL
        ) {
            return;
        }

        if (
            typeof tick.quote !==
                'number' ||
            !Number.isFinite(
                tick.quote
            )
        ) {
            return;
        }

        const currentPrice =
            tick.quote;

        setConnected(true);
        setConnectionError('');

        setPrice(
            currentPrice
        );

        /*
         * Dernier chiffre
         */

        const priceString =
            currentPrice.toFixed(
                5
            );

        const digit =
            Number(
                priceString[
                    priceString.length -
                        1
                ]
            );

        setLastDigit(
            digit
        );

        /*
         * Premier tick
         */

        if (
            previousPriceRef.current ===
            null
        ) {
            previousPriceRef.current =
                currentPrice;

            priceHistoryRef.current.push(
                currentPrice
            );

            setHistoryCount(
                priceHistoryRef.current.length
            );

            return;
        }

        const previousPrice =
            previousPriceRef.current;

        const direction =
            getDirection(
                previousPrice,
                currentPrice
            );

        previousPriceRef.current =
            currentPrice;

        /*
         * Historique prix
         */

        priceHistoryRef.current.push(
            currentPrice
        );

        if (
            priceHistoryRef.current
                .length >
            HISTORY_SIZE
        ) {
            priceHistoryRef.current.shift();
        }

        /*
         * Historique directions
         */

        directionHistoryRef.current.push(
            direction
        );

        if (
            directionHistoryRef.current
                .length >
            HISTORY_SIZE
        ) {
            directionHistoryRef.current.shift();
        }

        const historyLength =
            directionHistoryRef.current
                .length;

        setHistoryCount(
            Math.min(
                historyLength,
                HISTORY_SIZE
            )
        );

        setCurrentDirection(
            direction
        );

        /*
         * =====================================================
         * APPRENTISSAGE
         * =====================================================
         */

        if (
            historyLength <
            HISTORY_SIZE
        ) {
            setPhase(
                'learning'
            );

            const result =
                calculatePrediction();

            setPrediction(
                result.direction
            );

            setPredictionStrength(
                result.strength
            );

            setObservations(
                result.observations
            );

            return;
        }

        /*
         * Une fois les 500 ticks
         * collectés, on prépare
         * la prédiction.
         */

        if (
            predictionRef.current ===
            null
        ) {
            const result =
                calculatePrediction();

            predictionRef.current =
                result.direction;

            setPrediction(
                result.direction
            );

            setPredictionStrength(
                result.strength
            );

            setObservations(
                result.observations
            );
        }

        /*
         * =====================================================
         * LE TEST NE TOURNE QUE SI
         * L'UTILISATEUR A APPUYÉ
         * SUR LE BOUTON.
         * =====================================================
         */

        if (
            testModeRef.current !==
            'testing'
        ) {
            return;
        }

        /*
         * =====================================================
         * VALIDATION
         * =====================================================
         */

        const previousPrediction =
            predictionRef.current;

        if (
            previousPrediction !==
                null &&
            testsRef.current <
                PAPER_TEST_LIMIT
        ) {
            testsRef.current += 1;

            blockTestsRef.current +=
                1;

            if (
                previousPrediction ===
                direction
            ) {
                winsRef.current +=
                    1;

                blockWinsRef.current +=
                    1;

                virtualProfitRef.current +=
                    1;
            } else {
                lossesRef.current +=
                    1;

                virtualProfitRef.current -=
                    1;
            }

            /*
             * Bloc de 100
             */

            if (
                blockTestsRef.current ===
                BLOCK_SIZE
            ) {
                const rate =
                    (
                        blockWinsRef.current /
                        BLOCK_SIZE
                    ) *
                    100;

                setBlocks(
                    previous => [
                        ...previous,
                        rate,
                    ]
                );

                blockTestsRef.current =
                    0;

                blockWinsRef.current =
                    0;
            }

            setStats({
                tests:
                    testsRef.current,

                wins:
                    winsRef.current,

                losses:
                    lossesRef.current,

                virtualProfit:
                    virtualProfitRef.current,
            });

            setCurrentBlockWins(
                blockWinsRef.current
            );

            setCurrentBlockTests(
                blockTestsRef.current
            );
        }

        /*
         * =====================================================
         * FIN DES 1000 TESTS
         * =====================================================
         */

        if (
            testsRef.current >=
            PAPER_TEST_LIMIT
        ) {
            testModeRef.current =
                'done';

            setTestMode(
                'done'
            );

            setPhase('done');

            const finalResult =
                calculatePrediction();

            predictionRef.current =
                finalResult.direction;

            setPrediction(
                finalResult.direction
            );

            setPredictionStrength(
                finalResult.strength
            );

            setObservations(
                finalResult.observations
            );

            return;
        }

        /*
         * =====================================================
         * NOUVELLE PRÉDICTION
         * =====================================================
         */

        const result =
            calculatePrediction();

        predictionRef.current =
            result.direction;

        setPrediction(
            result.direction
        );

        setPredictionStrength(
            result.strength
        );

        setObservations(
            result.observations
        );
    };

    /*
     * =========================================================
     * CONNEXION DERIV
     * =========================================================
     */

    useEffect(() => {
        let mounted = true;

        if (!api_base?.api) {
            setConnectionError(
                'api_base.api est indisponible.'
            );

            return () => {
                mounted = false;
            };
        }

        if (
            subscribedRef.current
        ) {
            return () => {
                mounted = false;
            };
        }

        subscribedRef.current =
            true;

        let messageSubscription:
            | {
                  unsubscribe?: () => void;
              }
            | undefined;

        try {
            messageSubscription =
                api_base.api
                    .onMessage()
                    .subscribe(
                        ({
                            data,
                        }: {
                            data: any;
                        }) => {
                            if (
                                !mounted
                            ) {
                                return;
                            }

                            if (
                                !data
                            ) {
                                return;
                            }

                            /*
                             * TICK
                             */

                            if (
                                data.msg_type ===
                                'tick'
                            ) {
                                processTick(
                                    data.tick
                                );
                            }

                            /*
                             * BALANCE
                             */

                            if (
                                data.msg_type ===
                                'balance'
                            ) {
                                processBalance(
                                    data
                                );
                            }

                            /*
                             * ERREUR
                             */

                            if (
                                data.msg_type ===
                                    'error' ||
                                data.error
                            ) {
                                const message =
                                    data.error
                                        ?.message ||
                                    data.error ||
                                    'Erreur Deriv inconnue';

                                const text =
                                    String(
                                        message
                                    );

                                if (
                                    text
                                        .toLowerCase()
                                        .includes(
                                            'balance'
                                        ) ||
                                    text
                                        .toLowerCase()
                                        .includes(
                                            'authoriz'
                                        ) ||
                                    text
                                        .toLowerCase()
                                        .includes(
                                            'subscribed'
                                        )
                                ) {
                                    setBalanceError(
                                        text
                                    );
                                } else {
                                    setConnectionError(
                                        text
                                    );

                                    setConnected(
                                        false
                                    );
                                }
                            }
                        }
                    );

            /*
             * Flux EUR/USD
             */

            api_base.api.send({
                ticks:
                    MARKET_SYMBOL,
                subscribe: 1,
            });

            /*
             * Solde
             */

            requestCurrentBalance();

            setConnectionError('');
        } catch (error: any) {
            setConnectionError(
                error?.message ||
                    'Impossible de démarrer le flux Deriv.'
            );

            setConnected(false);
        }

        return () => {
            mounted = false;

            try {
                if (
                    messageSubscription &&
                    typeof messageSubscription.unsubscribe ===
                        'function'
                ) {
                    messageSubscription.unsubscribe();
                }
            } catch (error) {
                console.log(
                    'Erreur nettoyage abonnement EUR/USD',
                    error
                );
            }

            subscribedRef.current =
                false;

            balanceRequestedRef.current =
                false;
        };
    }, []);

    /*
     * =========================================================
     * STATISTIQUES
     * =========================================================
     */

    const totalTests =
        stats.tests;

    const winRate =
        totalTests > 0
            ? (
                  stats.wins /
                  totalTests
              ) * 100
            : 0;

    const lossRate =
        totalTests > 0
            ? (
                  stats.losses /
                  totalTests
              ) * 100
            : 0;

    const averageBlock =
        blocks.length > 0
            ? blocks.reduce(
                  (
                      sum,
                      value
                  ) =>
                      sum + value,
                  0
              ) /
              blocks.length
            : 0;

    const minimumBlock =
        blocks.length > 0
            ? Math.min(
                  ...blocks
              )
            : 0;

    const maximumBlock =
        blocks.length > 0
            ? Math.max(
                  ...blocks
              )
            : 0;

    const displayPrice =
        price !== null
            ? price.toFixed(5)
            : '—';

    /*
     * =========================================================
     * TEXTE DU BOUTON
     * =========================================================
     */

    const testButtonDisabled =
        !connected ||
        historyCount <
            HISTORY_SIZE ||
        testMode === 'testing';

    /*
     * =========================================================
     * INTERFACE
     * =========================================================
     */

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
                touchAction: 'pan-y',
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
                    width: '100%',
                    maxWidth:
                        '1000px',
                    margin:
                        '0 auto',
                    paddingBottom:
                        '50px',
                    boxSizing:
                        'border-box',
                }}
            >
                {/* TITRE */}

                <h1
                    style={{
                        textAlign:
                            'center',
                        fontSize:
                            'clamp(21px, 5vw, 28px)',
                        lineHeight:
                            '1.3',
                        marginTop:
                            '8px',
                        marginBottom:
                            '20px',
                    }}
                >
                    Moniteur Forex EUR/USD —
                    V4.11 Demo + Paper Trader
                </h1>

                {/* CONNEXION */}

                <div
                    style={{
                        background:
                            connected
                                ? '#064e3b'
                                : '#451a03',
                        border:
                            `1px solid ${
                                connected
                                    ? '#10b981'
                                    : '#f59e0b'
                            }`,
                        borderRadius:
                            '12px',
                        padding:
                            '14px',
                        marginBottom:
                            '16px',
                        textAlign:
                            'center',
                        fontWeight:
                            'bold',
                    }}
                >
                    {connected
                        ? '🟢 Connecté à Deriv — EUR/USD'
                        : '🟠 Connexion à Deriv…'}
                </div>

                {connectionError && (
                    <div
                        style={{
                            background:
                                '#450a0a',
                            border:
                                '1px solid #ef4444',
                            borderRadius:
                                '10px',
                            padding:
                                '12px',
                            marginBottom:
                                '16px',
                            color:
                                '#fecaca',
                            overflowWrap:
                                'anywhere',
                        }}
                    >
                        ⚠️{' '}
                        {connectionError}
                    </div>
                )}

                {/* COMPTE */}

                <div
                    style={{
                        background:
                            '#111827',
                        border:
                            '1px solid #374151',
                        borderRadius:
                            '14px',
                        padding:
                            '18px',
                        marginBottom:
                            '16px',
                    }}
                >
                    <h2
                        style={{
                            marginTop:
                                0,
                        }}
                    >
                        💰 Compte Deriv
                    </h2>

                    {balanceInfo ? (
                        <>
                            <div
                                style={{
                                    fontSize:
                                        '28px',
                                    fontWeight:
                                        'bold',
                                }}
                            >
                                {balanceInfo.balance.toFixed(
                                    2
                                )}{' '}
                                {
                                    balanceInfo.currency
                                }
                            </div>

                            {balanceInfo.loginid && (
                                <div
                                    style={{
                                        color:
                                            '#9ca3af',
                                        marginTop:
                                            '6px',
                                        overflowWrap:
                                            'anywhere',
                                    }}
                                >
                                    Compte :
                                    {' '}
                                    {
                                        balanceInfo.loginid
                                    }
                                </div>
                            )}

                            <div
                                style={{
                                    marginTop:
                                        '8px',
                                    color:
                                        '#86efac',
                                }}
                            >
                                🟢 Solde reçu
                                depuis Deriv
                            </div>
                        </>
                    ) : (
                        <div
                            style={{
                                color:
                                    '#fbbf24',
                            }}
                        >
                            🟠 Solde Demo
                            indisponible
                        </div>
                    )}

                    {balanceError && (
                        <div
                            style={{
                                marginTop:
                                    '12px',
                                padding:
                                    '10px',
                                background:
                                    '#450a0a',
                                border:
                                    '1px solid #ef4444',
                                borderRadius:
                                    '8px',
                                color:
                                    '#fecaca',
                                fontSize:
                                    '14px',
                                overflowWrap:
                                    'anywhere',
                            }}
                        >
                            ⚠️ Compte :
                            {' '}
                            {balanceError}
                        </div>
                    )}
                </div>

                {/* MARCHÉ */}

                <div
                    style={{
                        background:
                            '#111827',
                        border:
                            '1px solid #374151',
                        borderRadius:
                            '14px',
                        padding:
                            '18px',
                        marginBottom:
                            '16px',
                    }}
                >
                    <h2
                        style={{
                            marginTop:
                                0,
                        }}
                    >
                        📊 Marché
                    </h2>

                    <div
                        style={{
                            display:
                                'grid',
                            gridTemplateColumns:
                                'repeat(auto-fit, minmax(150px, 1fr))',
                            gap:
                                '14px',
                        }}
                    >
                        <div>
                            <div
                                style={{
                                    color:
                                        '#9ca3af',
                                }}
                            >
                                Marché
                            </div>

                            <strong>
                                {
                                    MARKET_NAME
                                }
                            </strong>
                        </div>

                        <div>
                            <div
                                style={{
                                    color:
                                        '#9ca3af',
                                }}
                            >
                                Symbole
                            </div>

                            <strong>
                                {
                                    MARKET_SYMBOL
                                }
                            </strong>
                        </div>

                        <div>
                            <div
                                style={{
                                    color:
                                        '#9ca3af',
                                }}
                            >
                                Prix
                            </div>

                            <strong
                                style={{
                                    fontSize:
                                        '22px',
                                }}
                            >
                                {
                                    displayPrice
                                }
                            </strong>
                        </div>

                        <div>
                            <div
                                style={{
                                    color:
                                        '#9ca3af',
                                }}
                            >
                                Dernier chiffre
                            </div>

                            <strong
                                style={{
                                    fontSize:
                                        '22px',
                                }}
                            >
                                {lastDigit ??
                                    '—'}
                            </strong>
                        </div>
                    </div>
                </div>

                {/* APPRENTISSAGE */}

                <div
                    style={{
                        background:
                            '#111827',
                        border:
                            '1px solid #374151',
                        borderRadius:
                            '14px',
                        padding:
                            '18px',
                        marginBottom:
                            '16px',
                    }}
                >
                    <h2
                        style={{
                            marginTop:
                                0,
                        }}
                    >
                        🧠 Phase 1 —
                        Apprentissage
                    </h2>

                    <div
                        style={{
                            marginBottom:
                                '12px',
                        }}
                    >
                        Historique :
                        {' '}
                        <strong>
                            {
                                historyCount
                            }
                            /
                            {
                                HISTORY_SIZE
                            }
                        </strong>
                    </div>

                    <div
                        style={{
                            height:
                                '10px',
                            background:
                                '#1f2937',
                            borderRadius:
                                '10px',
                            overflow:
                                'hidden',
                        }}
                    >
                        <div
                            style={{
                                width:
                                    `${
                                        Math.min(
                                            (
                                                historyCount /
                                                HISTORY_SIZE
                                            ) *
                                                100,
                                            100
                                        )
                                    }%`,
                                height:
                                    '100%',
                                background:
                                    '#22c55e',
                                transition:
                                    'width 0.2s ease',
                            }}
                        />
                    </div>
                </div>

                {/* ANALYSE */}

                <div
                    style={{
                        background:
                            '#111827',
                        border:
                            '1px solid #374151',
                        borderRadius:
                            '14px',
                        padding:
                            '18px',
                        marginBottom:
                            '16px',
                    }}
                >
                    <h2
                        style={{
                            marginTop:
                                0,
                        }}
                    >
                        🔎 Analyse en
                        temps réel
                    </h2>

                    <div
                        style={{
                            display:
                                'grid',
                            gridTemplateColumns:
                                'repeat(auto-fit, minmax(150px, 1fr))',
                            gap:
                                '14px',
                        }}
                    >
                        <div>
                            <div
                                style={{
                                    color:
                                        '#9ca3af',
                                }}
                            >
                                Direction actuelle
                            </div>

                            <strong>
                                {directionLabel(
                                    currentDirection
                                )}
                            </strong>
                        </div>

                        <div>
                            <div
                                style={{
                                    color:
                                        '#9ca3af',
                                }}
                            >
                                Prochaine prédiction
                            </div>

                            <strong>
                                {directionLabel(
                                    prediction
                                )}
                            </strong>
                        </div>

                        <div>
                            <div
                                style={{
                                    color:
                                        '#9ca3af',
                                }}
                            >
                                Force
                            </div>

                            <strong>
                                {
                                    predictionStrength.toFixed(
                                        1
                                    )
                                }
                                %
                            </strong>
                        </div>

                        <div>
                            <div
                                style={{
                                    color:
                                        '#9ca3af',
                                }}
                            >
                                Observations
                            </div>

                            <strong>
                                {
                                    observations
                                }
                            </strong>
                        </div>
                    </div>

                    <div
                        style={{
                            marginTop:
                                '16px',
                            padding:
                                '12px',
                            background:
                                '#172033',
                            borderRadius:
                                '10px',
                            color:
                                '#cbd5e1',
                        }}
                    >
                        ℹ️ L'analyse utilise
                        les dernières
                        directions du
                        marché pour
                        produire une
                        indication
                        UP/DOWN.
                    </div>
                </div>

                {/* =================================================
                    NOUVEAU : CONTRÔLE DEMO
                ================================================= */}

                <div
                    style={{
                        background:
                            '#111827',
                        border:
                            '1px solid #475569',
                        borderRadius:
                            '16px',
                        padding:
                            '20px',
                        marginBottom:
                            '16px',
                        textAlign:
                            'center',
                    }}
                >
                    <h2
                        style={{
                            marginTop:
                                0,
                        }}
                    >
                        🎮 Test Demo
                    </h2>

                    <div
                        style={{
                            color:
                                '#94a3b8',
                            marginBottom:
                                '16px',
                            lineHeight:
                                '1.5',
                        }}
                    >
                        Le bouton démarre le
                        test de la stratégie
                        avec les ticks EUR/USD
                        en mode virtuel.
                    </div>

                    {testMode ===
                        'idle' && (
                        <button
                            onClick={
                                startDemoTest
                            }
                            disabled={
                                testButtonDisabled
                            }
                            style={{
                                width:
                                    '100%',
                                minHeight:
                                    '58px',
                                border:
                                    'none',
                                borderRadius:
                                    '14px',
                                background:
                                    testButtonDisabled
                                        ? '#374151'
                                        : '#16a34a',
                                color:
                                    '#ffffff',
                                fontSize:
                                    '18px',
                                fontWeight:
                                    'bold',
                                cursor:
                                    testButtonDisabled
                                        ? 'not-allowed'
                                        : 'pointer',
                                touchAction:
                                    'manipulation',
                            }}
                        >
                            ▶️ TESTER SUR
                            COMPTE DÉMO
                        </button>
                    )}

                    {testMode ===
                        'testing' && (
                        <button
                            onClick={
                                stopDemoTest
                            }
                            style={{
                                width:
                                    '100%',
                                minHeight:
                                    '58px',
                                border:
                                    'none',
                                borderRadius:
                                    '14px',
                                background:
                                    '#dc2626',
                                color:
                                    '#ffffff',
                                fontSize:
                                    '18px',
                                fontWeight:
                                    'bold',
                                cursor:
                                    'pointer',
                                touchAction:
                                    'manipulation',
                            }}
                        >
                            ⏹️ ARRÊTER LE TEST
                        </button>
                    )}

                    {testMode ===
                        'stopped' && (
                        <>
                            <div
                                style={{
                                    padding:
                                        '12px',
                                    marginBottom:
                                        '12px',
                                    background:
                                        '#422006',
                                    borderRadius:
                                        '10px',
                                    color:
                                        '#fde68a',
                                }}
                            >
                                ⏸️ Test arrêté.
                            </div>

                            <button
                                onClick={
                                    startDemoTest
                                }
                                style={{
                                    width:
                                        '100%',
                                    minHeight:
                                        '54px',
                                    border:
                                        'none',
                                    borderRadius:
                                        '12px',
                                    background:
                                        '#16a34a',
                                    color:
                                        '#ffffff',
                                    fontSize:
                                        '17px',
                                    fontWeight:
                                        'bold',
                                    cursor:
                                        'pointer',
                                }}
                            >
                                ▶️ REPRENDRE LE TEST
                            </button>
                        </>
                    )}

                    {testMode ===
                        'done' && (
                        <>
                            <div
                                style={{
                                    padding:
                                        '12px',
                                    marginBottom:
                                        '12px',
                                    background:
                                        '#052e16',
                                    border:
                                        '1px solid #22c55e',
                                    borderRadius:
                                        '10px',
                                    color:
                                        '#bbf7d0',
                                }}
                            >
                                ✅ Test de 1000
                                observations
                                terminé.
                            </div>

                            <button
                                onClick={
                                    resetPaperTest
                                }
                                style={{
                                    width:
                                        '100%',
                                    minHeight:
                                        '54px',
                                    border:
                                        'none',
                                    borderRadius:
                                        '12px',
                                    background:
                                        '#2563eb',
                                    color:
                                        '#ffffff',
                                    fontSize:
                                        '17px',
                                    fontWeight:
                                        'bold',
                                    cursor:
                                        'pointer',
                                }}
                            >
                                🔄 RECOMMENCER
                            </button>
                        </>
                    )}

                    {!connected && (
                        <div
                            style={{
                                marginTop:
                                    '12px',
                                color:
                                    '#fbbf24',
                                fontSize:
                                    '14px',
                            }}
                        >
                            ⏳ Attente de la
                            connexion au
                            marché…
                        </div>
                    )}

                    {connected &&
                        historyCount <
                            HISTORY_SIZE && (
                            <div
                                style={{
                                    marginTop:
                                        '12px',
                                    color:
                                        '#fbbf24',
                                    fontSize:
                                        '14px',
                                }}
                            >
                                ⏳ Collecte des
                                500 ticks :
                                {' '}
                                {
                                    historyCount
                                }
                                /
                                {
                                    HISTORY_SIZE
                                }
                            </div>
                        )}

                    <div
                        style={{
                            marginTop:
                                '16px',
                            padding:
                                '12px',
                            background:
                                '#1f2937',
                            borderRadius:
                                '10px',
                            color:
                                '#fca5a5',
                            fontSize:
                                '13px',
                            lineHeight:
                                '1.5',
                        }}
                    >
                        🛡️ SÉCURITÉ
                        <br />
                        Cette V4.11 n'envoie
                        aucun ordre BUY/SELL
                        à Deriv.
                        <br />
                        Les résultats restent
                        virtuels.
                    </div>
                </div>

                {/* PAPER TRADING */}

                <div
                    style={{
                        background:
                            '#111827',
                        border:
                            '1px solid #374151',
                        borderRadius:
                            '14px',
                        padding:
                            '18px',
                        marginBottom:
                            '16px',
                    }}
                >
                    <h2
                        style={{
                            marginTop:
                                0,
                        }}
                    >
                        🧪 Phase 2 —
                        Paper Trading
                    </h2>

                    <div
                        style={{
                            display:
                                'grid',
                            gridTemplateColumns:
                                'repeat(auto-fit, minmax(140px, 1fr))',
                            gap:
                                '12px',
                        }}
                    >
                        <div>
                            <div
                                style={{
                                    color:
                                        '#9ca3af',
                                }}
                            >
                                Tests
                            </div>

                            <strong>
                                {
                                    stats.tests
                                }
                                /
                                {
                                    PAPER_TEST_LIMIT
                                }
                            </strong>
                        </div>

                        <div>
                            <div
                                style={{
                                    color:
                                        '#9ca3af',
                                }}
                            >
                                Gains
                            </div>

                            <strong>
                                {
                                    stats.wins
                                }
                            </strong>
                        </div>

                        <div>
                            <div
                                style={{
                                    color:
                                        '#9ca3af',
                                }}
                            >
                                Pertes
                            </div>

                            <strong>
                                {
                                    stats.losses
                                }
                            </strong>
                        </div>

                        <div>
                            <div
                                style={{
                                    color:
                                        '#9ca3af',
                                }}
                            >
                                Taux gain
                            </div>

                            <strong>
                                {
                                    winRate.toFixed(
                                        2
                                    )
                                }
                                %
                            </strong>
                        </div>

                        <div>
                            <div
                                style={{
                                    color:
                                        '#9ca3af',
                                }}
                            >
                                Taux perte
                            </div>

                            <strong>
                                {
                                    lossRate.toFixed(
                                        2
                                    )
                                }
                                %
                            </strong>
                        </div>
                    </div>

                    <div
                        style={{
                            marginTop:
                                '18px',
                            padding:
                                '16px',
                            background:
                                '#172033',
                            borderRadius:
                                '12px',
                            textAlign:
                                'center',
                        }}
                    >
                        <div
                            style={{
                                color:
                                    '#9ca3af',
                            }}
                        >
                            Résultat virtuel
                        </div>

                        <div
                            style={{
                                fontSize:
                                    '32px',
                                fontWeight:
                                    'bold',
                                marginTop:
                                    '5px',
                            }}
                        >
                            {stats.virtualProfit >=
                            0
                                ? '+'
                                : ''}
                            {
                                stats.virtualProfit
                            }
                        </div>

                        <div
                            style={{
                                marginTop:
                                    '6px',
                                color:
                                    '#9ca3af',
                            }}
                        >
                            +1 prédiction
                            correcte /
                            -1 prédiction
                            incorrecte
                        </div>
                    </div>
                </div>

                {/* BLOCS */}

                <div
                    style={{
                        background:
                            '#111827',
                        border:
                            '1px solid #374151',
                        borderRadius:
                            '14px',
                        padding:
                            '18px',
                        marginBottom:
                            '16px',
                    }}
                >
                    <h2
                        style={{
                            marginTop:
                                0,
                        }}
                    >
                        📦 Blocs de{' '}
                        {BLOCK_SIZE}
                    </h2>

                    <div>
                        Blocs terminés :
                        {' '}
                        <strong>
                            {
                                blocks.length
                            }
                        </strong>
                    </div>

                    {blocks.length >
                        0 && (
                        <>
                            <div
                                style={{
                                    marginTop:
                                        '10px',
                                }}
                            >
                                Moyenne :
                                {' '}
                                <strong>
                                    {
                                        averageBlock.toFixed(
                                            2
                                        )
                                    }
                                    %
                                </strong>
                            </div>

                            <div
                                style={{
                                    marginTop:
                                        '6px',
                                }}
                            >
                                Minimum :
                                {' '}
                                <strong>
                                    {
                                        minimumBlock.toFixed(
                                            2
                                        )
                                    }
                                    %
                                </strong>
                            </div>

                            <div
                                style={{
                                    marginTop:
                                        '6px',
                                }}
                            >
                                Maximum :
                                {' '}
                                <strong>
                                    {
                                        maximumBlock.toFixed(
                                            2
                                        )
                                    }
                                    %
                                </strong>
                            </div>
                        </>
                    )}

                    <div
                        style={{
                            marginTop:
                                '14px',
                            color:
                                '#9ca3af',
                        }}
                    >
                        Bloc actuel :
                        {' '}
                        <strong>
                            {
                                currentBlockWins
                            }
                            /
                            {
                                currentBlockTests
                            }
                        </strong>
                    </div>
                </div>

                {/* ÉTAT */}

                <div
                    style={{
                        background:
                            phase ===
                            'done'
                                ? '#052e16'
                                : '#172033',
                        border:
                            `1px solid ${
                                phase ===
                                'done'
                                    ? '#22c55e'
                                    : '#374151'
                            }`,
                        borderRadius:
                            '14px',
                        padding:
                            '18px',
                        marginBottom:
                            '16px',
                        textAlign:
                            'center',
                        lineHeight:
                            '1.5',
                    }}
                >
                    {phase ===
                        'learning' && (
                        <>
                            🧠 Collecte de
                            données…
                        </>
                    )}

                    {phase ===
                        'testing' && (
                        <>
                            🧪 Test Demo
                            virtuel en
                            cours…
                        </>
                    )}

                    {phase ===
                        'done' && (
                        <>
                            ✅ Test terminé —
                            prédiction finale
                            conservée
                        </>
                    )}
                </div>

                {/* SÉCURITÉ */}

                <div
                    style={{
                        background:
                            '#1f2937',
                        border:
                            '1px solid #4b5563',
                        borderRadius:
                            '12px',
                        padding:
                            '18px',
                        marginBottom:
                            '20px',
                        textAlign:
                            'center',
                        lineHeight:
                            '1.6',
                    }}
                >
                    <strong>
                        🛡️ MODE TEST UNIQUEMENT
                    </strong>

                    <div
                        style={{
                            marginTop:
                                '8px',
                            color:
                                '#fca5a5',
                        }}
                    >
                        ❌ Aucun trade
                        automatique réel
                        ou Demo n'est
                        envoyé.
                    </div>

                    <div
                        style={{
                            marginTop:
                                '5px',
                            fontSize:
                                '13px',
                            color:
                                '#9ca3af',
                        }}
                    >
                        Le bouton
                        « Tester sur
                        compte Demo »
                        démarre le
                        paper test avec
                        les données
                        réelles du marché,
                        mais sans ordre
                        financier.
                    </div>
                </div>

                {/* SCROLL */}

                <div
                    style={{
                        textAlign:
                            'center',
                        padding:
                            '10px',
                        color:
                            '#64748b',
                        fontSize:
                            '12px',
                    }}
                >
                    ↕️ Fais glisser
                    l'écran pour voir
                    toutes les
                    informations
                </div>
            </div>
        </div>
    );
}

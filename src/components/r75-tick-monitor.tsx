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

const getDirection = (
    previous: number,
    current: number
): Direction => {
    return current >= previous ? 'UP' : 'DOWN';
};

const directionLabel = (
    direction: Direction | null
) => {
    if (direction === 'UP') return '🟢 HAUSSE';
    if (direction === 'DOWN') return '🔴 BAISSE';
    return '—';
};

export default function R75TickMonitor() {
    const [connected, setConnected] = useState(false);
    const [connectionError, setConnectionError] = useState('');

    const [price, setPrice] = useState<number | null>(null);
    const [lastDigit, setLastDigit] = useState<number | null>(null);

    const [historyCount, setHistoryCount] = useState(0);

    const [phase, setPhase] = useState<
        'learning' | 'testing' | 'done'
    >('learning');

    const [currentDirection, setCurrentDirection] =
        useState<Direction | null>(null);

    const [prediction, setPrediction] =
        useState<Direction | null>(null);

    const [predictionStrength, setPredictionStrength] =
        useState(0);

    const [observations, setObservations] =
        useState(0);

    const [stats, setStats] = useState<Stats>({
        tests: 0,
        wins: 0,
        losses: 0,
        virtualProfit: 0,
    });

    const [blocks, setBlocks] = useState<number[]>([]);

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

    /*
     * ---------------------------------------------------------
     * ANALYSE
     * ---------------------------------------------------------
     */

    const calculatePrediction = () => {
        const history =
            directionHistoryRef.current;

        const recent =
            history.slice(-ANALYSIS_WINDOW);

        if (recent.length < 5) {
            return {
                direction: null as Direction | null,
                strength: 0,
                observations: recent.length,
            };
        }

        let up = 0;
        let down = 0;

        recent.forEach(direction => {
            if (direction === 'UP') {
                up += 1;
            } else {
                down += 1;
            }
        });

        const total = up + down;

        if (total === 0) {
            return {
                direction: null as Direction | null,
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
                direction: 'UP' as Direction,
                strength: upPercent,
                observations: total,
            };
        }

        return {
            direction: 'DOWN' as Direction,
            strength: downPercent,
            observations: total,
        };
    };

    /*
     * ---------------------------------------------------------
     * BALANCE
     * ---------------------------------------------------------
     *
     * IMPORTANT V4.9:
     *
     * We DO NOT send:
     *
     * { balance: 1, subscribe: 1 }
     *
     * because the Deriv application may already have a
     * balance subscription.
     *
     * We only send:
     *
     * { balance: 1 }
     *
     * This asks for the current balance without creating
     * another balance subscription.
     */

    const requestCurrentBalance = () => {
        if (!api_base?.api) {
            return;
        }

        if (balanceRequestedRef.current) {
            return;
        }

        balanceRequestedRef.current = true;

        try {
            api_base.api.send({
                balance: 1,
                req_id: 4901,
            });
        } catch (error: any) {
            balanceRequestedRef.current = false;

            setBalanceError(
                error?.message ||
                    'Impossible de demander le solde Demo.'
            );
        }
    };

    /*
     * ---------------------------------------------------------
     * TRAITEMENT DU SOLDE
     * ---------------------------------------------------------
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
            data.balance.currency || 'USD';

        const loginid =
            data.balance.loginid;

        if (
            typeof rawBalance !== 'number' ||
            !Number.isFinite(rawBalance)
        ) {
            return;
        }

        setBalanceInfo({
            balance: rawBalance,
            currency,
            loginid,
        });

        setBalanceReceived(true);
        setBalanceError('');
    };

    /*
     * ---------------------------------------------------------
     * TRAITEMENT DES TICKS
     * ---------------------------------------------------------
     */

    const processTick = (
        tick: Tick
    ) => {
        if (
            tick.symbol !== MARKET_SYMBOL
        ) {
            return;
        }

        if (
            typeof tick.quote !== 'number' ||
            !Number.isFinite(tick.quote)
        ) {
            return;
        }

        const currentPrice =
            tick.quote;

        setConnected(true);
        setConnectionError('');

        setPrice(currentPrice);

        /*
         * Dernier chiffre
         */

        const priceString =
            currentPrice.toFixed(5);

        const digit =
            Number(
                priceString[
                    priceString.length - 1
                ]
            );

        setLastDigit(digit);

        /*
         * Premier tick
         */

        if (
            previousPriceRef.current === null
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

        /*
         * Direction
         */

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
            priceHistoryRef.current.length >
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
            directionHistoryRef.current.length >
            HISTORY_SIZE
        ) {
            directionHistoryRef.current.shift();
        }

        const historyLength =
            directionHistoryRef.current.length;

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
         * -----------------------------------------------------
         * PHASE 1 : APPRENTISSAGE
         * -----------------------------------------------------
         */

        if (
            historyLength <
            HISTORY_SIZE
        ) {
            setPhase('learning');

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
         * -----------------------------------------------------
         * PREMIÈRE PRÉDICTION
         * -----------------------------------------------------
         */

        if (
            testsRef.current === 0 &&
            predictionRef.current === null
        ) {
            setPhase('testing');

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

            return;
        }

        /*
         * -----------------------------------------------------
         * VALIDATION DE LA PRÉDICTION PRÉCÉDENTE
         * -----------------------------------------------------
         */

        const previousPrediction =
            predictionRef.current;

        if (
            previousPrediction !== null &&
            testsRef.current <
                PAPER_TEST_LIMIT
        ) {
            testsRef.current += 1;

            blockTestsRef.current += 1;

            if (
                previousPrediction ===
                direction
            ) {
                winsRef.current += 1;

                blockWinsRef.current += 1;

                virtualProfitRef.current += 1;
            } else {
                lossesRef.current += 1;

                virtualProfitRef.current -= 1;
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
                    ) * 100;

                setBlocks(
                    previous => [
                        ...previous,
                        rate,
                    ]
                );

                blockTestsRef.current = 0;

                blockWinsRef.current = 0;
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
         * -----------------------------------------------------
         * FIN DES 1000 TESTS
         * -----------------------------------------------------
         */

        if (
            testsRef.current >=
            PAPER_TEST_LIMIT
        ) {
            setPhase('done');

            /*
             * V4.9 conserve la dernière prédiction
             * au lieu de l'effacer.
             */

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
         * -----------------------------------------------------
         * NOUVELLE PRÉDICTION
         * -----------------------------------------------------
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
     * ---------------------------------------------------------
     * CONNEXION DERIV
     * ---------------------------------------------------------
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

        subscribedRef.current = true;

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
                            if (!mounted) {
                                return;
                            }

                            if (!data) {
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
                             *
                             * This can come from:
                             * - our one-shot request
                             * - an existing app subscription
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

                                /*
                                 * Ne pas transformer une
                                 * erreur balance en erreur
                                 * marché.
                                 */

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
             * Flux prix EUR/USD
             */

            api_base.api.send({
                ticks:
                    MARKET_SYMBOL,
                subscribe: 1,
            });

            /*
             * V4.9 :
             * UNE SEULE demande de solde.
             *
             * Pas de subscribe:1 ici.
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
        };
    }, []);

    /*
     * ---------------------------------------------------------
     * STATISTIQUES
     * ---------------------------------------------------------
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
     * ---------------------------------------------------------
     * AFFICHAGE
     * ---------------------------------------------------------
     */

    return (
        <div
            style={{
                minHeight: '100vh',
                background:
                    '#0f172a',
                color: '#e5e7eb',
                padding:
                    '20px',
                fontFamily:
                    'Arial, sans-serif',
                boxSizing:
                    'border-box',
            }}
        >
            <div
                style={{
                    maxWidth:
                        '1000px',
                    margin:
                        '0 auto',
                }}
            >
                <h1
                    style={{
                        textAlign:
                            'center',
                        fontSize:
                            '26px',
                        marginBottom:
                            '20px',
                    }}
                >
                    Moniteur Forex EUR/USD —
                    V4.9 Demo + Paper Trader
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
                        }}
                    >
                        ⚠️ Marché :
                        {' '}
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
                                        '25px',
                                    fontWeight:
                                        'bold',
                                    marginBottom:
                                        '8px',
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
                                🟢 Solde reçu depuis
                                Deriv
                            </div>
                        </>
                    ) : (
                        <>
                            <div
                                style={{
                                    color:
                                        '#fbbf24',
                                    marginBottom:
                                        '8px',
                                }}
                            >
                                🟠 Solde Demo
                                indisponible
                            </div>

                            <div
                                style={{
                                    color:
                                        '#9ca3af',
                                    fontSize:
                                        '14px',
                                }}
                            >
                                Le flux EUR/USD
                                fonctionne
                                indépendamment
                                du solde.
                            </div>
                        </>
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
                            }}
                        >
                            ⚠️ Compte :
                            {' '}
                            {balanceError}
                        </div>
                    )}
                </div>

                {/* MARCHE */}

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
                                'repeat(auto-fit,minmax(180px,1fr))',
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

                {/* PHASE 1 */}

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
                            /{HISTORY_SIZE}
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
                        🔎 Analyse en temps réel
                    </h2>

                    <div
                        style={{
                            display:
                                'grid',
                            gridTemplateColumns:
                                'repeat(auto-fit,minmax(180px,1fr))',
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

                            <strong
                                style={{
                                    fontSize:
                                        '20px',
                                }}
                            >
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

                            <strong
                                style={{
                                    fontSize:
                                        '20px',
                                }}
                            >
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
                        les dernières directions
                        du marché pour produire
                        une indication UP/DOWN.
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
                                'repeat(auto-fit,minmax(150px,1fr))',
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
                                /{PAPER_TEST_LIMIT}
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
                                    '30px',
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
                            Mise virtuelle :
                            +1 si prédiction
                            correcte /
                            -1 sinon
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
                        📦 Blocs de {BLOCK_SIZE}
                    </h2>

                    {blocks.length === 0 ? (
                        <div
                            style={{
                                color:
                                    '#9ca3af',
                            }}
                        >
                            Aucun bloc complet
                            pour le moment.
                        </div>
                    ) : (
                        <>
                            <div>
                                Blocs terminés :
                                {' '}
                                <strong>
                                    {
                                        blocks.length
                                    }
                                </strong>
                            </div>

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
                            phase === 'done'
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
                            🧪 Paper Trading
                            en cours…
                        </>
                    )}

                    {phase === 'done' && (
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
                            '16px',
                        textAlign:
                            'center',
                        color:
                            '#d1d5db',
                    }}
                >
                    <strong>
                        🛡️ MODE TEST UNIQUEMENT
                    </strong>

                    <div
                        style={{
                            marginTop:
                                '8px',
                        }}
                    >
                        ❌ Aucun trade automatique
                        réel.
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
                        Les gains et pertes
                        affichés sont
                        entièrement virtuels.
                    </div>
                </div>
            </div>
        </div>
    );
}

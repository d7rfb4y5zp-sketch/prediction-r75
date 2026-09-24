import React, { useEffect, useRef, useState } from 'react';
import { api_base } from '../external/bot-skeleton';

const MARKET_SYMBOL = 'frxEURUSD';
const MARKET_NAME = 'EUR/USD';

const HISTORY_SIZE = 500;
const PAPER_TEST_LIMIT = 1000;
const BLOCK_SIZE = 100;

type Direction = 'UP' | 'DOWN' | 'FLAT';

type Stats = {
    tests: number;
    wins: number;
    losses: number;
    skipped: number;
    virtualProfit: number;
};

type Matrix = {
    UP: {
        UP: number;
        DOWN: number;
        FLAT: number;
    };
    DOWN: {
        UP: number;
        DOWN: number;
        FLAT: number;
    };
    FLAT: {
        UP: number;
        DOWN: number;
        FLAT: number;
    };
};

const createMatrix = (): Matrix => ({
    UP: { UP: 0, DOWN: 0, FLAT: 0 },
    DOWN: { UP: 0, DOWN: 0, FLAT: 0 },
    FLAT: { UP: 0, DOWN: 0, FLAT: 0 },
});

const directionLabel = (direction: Direction) => {
    if (direction === 'UP') return '🟢 HAUSSE';
    if (direction === 'DOWN') return '🔴 BAISSE';
    return '⚪ STABLE';
};

const getDirection = (
    previous: number,
    current: number
): Direction => {
    if (current > previous) return 'UP';
    if (current < previous) return 'DOWN';
    return 'FLAT';
};

export default function R75TickMonitor() {
    const [connected, setConnected] = useState(false);
    const [price, setPrice] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    const [historyCount, setHistoryCount] = useState(0);

    const [phase, setPhase] = useState<
        'learning' | 'testing' | 'done'
    >('learning');

    const [currentDirection, setCurrentDirection] =
        useState<Direction>('FLAT');

    const [prediction, setPrediction] =
        useState<Direction | null>(null);

    const [predictionStrength, setPredictionStrength] =
        useState(0);

    const [stats, setStats] = useState<Stats>({
        tests: 0,
        wins: 0,
        losses: 0,
        skipped: 0,
        virtualProfit: 0,
    });

    const [blocks, setBlocks] = useState<number[]>([]);
    const [currentBlockWins, setCurrentBlockWins] =
        useState(0);

    const [matrix, setMatrix] =
        useState<Matrix>(createMatrix());

    /*
     * Dernier prix reçu.
     */
    const previousPriceRef =
        useRef<number | null>(null);

    /*
     * Historique des directions.
     */
    const historyRef =
        useRef<Direction[]>([]);

    /*
     * Matrice.
     */
    const matrixRef =
        useRef<Matrix>(createMatrix());

    /*
     * Dernière prédiction.
     */
    const predictionRef =
        useRef<Direction | null>(null);

    /*
     * Statistiques.
     */
    const testsRef = useRef(0);
    const winsRef = useRef(0);
    const lossesRef = useRef(0);
    const skippedRef = useRef(0);

    /*
     * Blocs.
     */
    const blockWinsRef = useRef(0);
    const blockTestsRef = useRef(0);

    /*
     * Résultat virtuel.
     */
    const virtualProfitRef = useRef(0);

    /*
     * Empêche de traiter deux fois
     * le même historique.
     */
    const historyInitializedRef =
        useRef(false);

    /*
     * Calcul de la prochaine direction.
     */
    const calculatePrediction = (
        current: Direction
    ) => {
        const row =
            matrixRef.current[current];

        const up = row.UP;
        const down = row.DOWN;
        const flat = row.FLAT;

        const total =
            up + down + flat;

        if (total === 0) {
            return {
                direction: 'FLAT' as Direction,
                strength: 0,
            };
        }

        let direction: Direction = 'FLAT';
        let highest = flat;

        if (up > highest) {
            direction = 'UP';
            highest = up;
        }

        if (down > highest) {
            direction = 'DOWN';
            highest = down;
        }

        return {
            direction,
            strength:
                (highest / total) * 100,
        };
    };

    useEffect(() => {
        let active = true;

        /*
         * =====================================================
         * TRAITEMENT D'UN PRIX
         * =====================================================
         */
        const processPrice = (
            currentPrice: number,
            isLiveTick = true
        ) => {
            if (!active) return;

            setConnected(true);
            setPrice(currentPrice);
            setError(null);

            /*
             * Premier prix.
             */
            if (
                previousPriceRef.current === null
            ) {
                previousPriceRef.current =
                    currentPrice;
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

            setCurrentDirection(direction);

            /*
             * =================================================
             * APPRENTISSAGE
             * =================================================
             */
            if (
                historyRef.current.length <
                HISTORY_SIZE
            ) {
                const history =
                    historyRef.current;

                /*
                 * Ajouter la nouvelle direction.
                 */
                history.push(direction);

                /*
                 * Ajouter la transition.
                 */
                if (history.length >= 2) {
                    const previousDirection =
                        history[
                            history.length - 2
                        ];

                    const currentDirection =
                        history[
                            history.length - 1
                        ];

                    matrixRef.current[
                        previousDirection
                    ][currentDirection] += 1;

                    setMatrix({
                        ...matrixRef.current,
                    });
                }

                setHistoryCount(
                    history.length
                );

                if (
                    history.length ===
                    HISTORY_SIZE
                ) {
                    historyInitializedRef.current =
                        true;

                    setPhase('testing');

                    /*
                     * Première prédiction.
                     */
                    const firstPrediction =
                        calculatePrediction(
                            direction
                        );

                    predictionRef.current =
                        firstPrediction.direction;

                    setPrediction(
                        firstPrediction.direction
                    );

                    setPredictionStrength(
                        firstPrediction.strength
                    );
                }

                return;
            }

            /*
             * =================================================
             * VALIDATION / PAPER TRADING
             * =================================================
             */

            if (
                predictionRef.current !== null &&
                testsRef.current <
                    PAPER_TEST_LIMIT
            ) {
                const predicted =
                    predictionRef.current;

                if (predicted === 'FLAT') {
                    skippedRef.current += 1;
                } else {
                    testsRef.current += 1;
                    blockTestsRef.current += 1;

                    if (
                        predicted ===
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
                     * Bloc de 100.
                     */
                    if (
                        blockTestsRef.current ===
                        BLOCK_SIZE
                    ) {
                        const rate =
                            (blockWinsRef.current /
                                BLOCK_SIZE) *
                            100;

                        setBlocks(
                            previous => [
                                ...previous,
                                rate,
                            ]
                        );

                        blockTestsRef.current = 0;
                        blockWinsRef.current = 0;
                    }

                    setCurrentBlockWins(
                        blockWinsRef.current
                    );
                }

                setStats({
                    tests: testsRef.current,
                    wins: winsRef.current,
                    losses: lossesRef.current,
                    skipped:
                        skippedRef.current,
                    virtualProfit:
                        virtualProfitRef.current,
                });
            }

            /*
             * Fin.
             */
            if (
                testsRef.current >=
                PAPER_TEST_LIMIT
            ) {
                setPhase('done');
                return;
            }

            /*
             * =================================================
             * NOUVELLE TRANSITION
             * =================================================
             */

            const history =
                historyRef.current;

            const lastDirection =
                history[
                    history.length - 1
                ];

            if (lastDirection) {
                matrixRef.current[
                    lastDirection
                ][direction] += 1;
            }

            history.push(direction);

            if (
                history.length >
                HISTORY_SIZE
            ) {
                history.shift();
            }

            setHistoryCount(
                history.length
            );

            setMatrix({
                ...matrixRef.current,
            });

            /*
             * Nouvelle prédiction.
             */
            const nextPrediction =
                calculatePrediction(
                    direction
                );

            predictionRef.current =
                nextPrediction.direction;

            setPrediction(
                nextPrediction.direction
            );

            setPredictionStrength(
                nextPrediction.strength
            );
        };

        /*
         * =====================================================
         * MESSAGE DERIV
         * =====================================================
         */
        const handleMessage = (
            message: any
        ) => {
            if (!active) return;

            /*
             * Erreur API.
             */
            if (message?.error) {
                setError(
                    message.error.message ||
                        'Erreur Deriv'
                );
                return;
            }

            /*
             * Historique de ticks.
             */
            if (
                message?.msg_type ===
                    'history' &&
                message?.history?.prices
            ) {
                const prices =
                    message.history.prices;

                if (
                    Array.isArray(prices) &&
                    prices.length > 0 &&
                    !historyInitializedRef.current
                ) {
                    /*
                     * Repartir proprement.
                     */
                    previousPriceRef.current =
                        null;

                    historyRef.current = [];

                    matrixRef.current =
                        createMatrix();

                    /*
                     * Utiliser les derniers
                     * 500 prix historiques.
                     */
                    const usablePrices =
                        prices.slice(
                            -HISTORY_SIZE
                        );

                    for (
                        let i = 0;
                        i <
                        usablePrices.length;
                        i++
                    ) {
                        const current =
                            Number(
                                usablePrices[i]
                            );

                        if (
                            !Number.isFinite(
                                current
                            )
                        ) {
                            continue;
                        }

                        if (
                            previousPriceRef.current ===
                            null
                        ) {
                            previousPriceRef.current =
                                current;
                            continue;
                        }

                        const previous =
                            previousPriceRef.current;

                        const direction =
                            getDirection(
                                previous,
                                current
                            );

                        previousPriceRef.current =
                            current;

                        historyRef.current.push(
                            direction
                        );

                        if (
                            historyRef.current
                                .length >= 2
                        ) {
                            const previousDirection =
                                historyRef.current[
                                    historyRef.current
                                        .length - 2
                                ];

                            const currentDirection =
                                historyRef.current[
                                    historyRef.current
                                        .length - 1
                                ];

                            matrixRef.current[
                                previousDirection
                            ][currentDirection] +=
                                1;
                        }
                    }

                    setHistoryCount(
                        historyRef.current.length
                    );

                    setMatrix({
                        ...matrixRef.current,
                    });

                    /*
                     * Afficher le dernier prix.
                     */
                    const lastPrice =
                        Number(
                            usablePrices[
                                usablePrices.length -
                                    1
                            ]
                        );

                    if (
                        Number.isFinite(
                            lastPrice
                        )
                    ) {
                        setPrice(lastPrice);
                    }

                    /*
                     * Si nous avons 500 directions,
                     * passer directement au test.
                     */
                    if (
                        historyRef.current.length >=
                        HISTORY_SIZE
                    ) {
                        historyInitializedRef.current =
                            true;

                        setConnected(true);
                        setPhase('testing');

                        const last =
                            historyRef.current[
                                historyRef.current
                                    .length - 1
                            ];

                        setCurrentDirection(last);

                        const firstPrediction =
                            calculatePrediction(
                                last
                            );

                        predictionRef.current =
                            firstPrediction.direction;

                        setPrediction(
                            firstPrediction.direction
                        );

                        setPredictionStrength(
                            firstPrediction.strength
                        );
                    }

                    return;
                }
            }

            /*
             * Tick temps réel.
             */
            if (
                message?.msg_type === 'tick' &&
                message?.tick
            ) {
                const tick =
                    message.tick;

                if (
                    tick.symbol !==
                    MARKET_SYMBOL
                ) {
                    return;
                }

                const quote =
                    Number(tick.quote);

                if (
                    !Number.isFinite(quote)
                ) {
                    return;
                }

                processPrice(
                    quote,
                    true
                );
            }
        };

        /*
         * Installer l'écoute AVANT la demande.
         */
        const unsubscribe =
            api_base.api.onMessage(
                handleMessage
            );

        /*
         * =====================================================
         * DEMANDE HISTORIQUE + ABONNEMENT
         * =====================================================
         */
        try {
            api_base.api.send({
                ticks_history:
                    MARKET_SYMBOL,
                end: 'latest',
                count: HISTORY_SIZE,
                style: 'ticks',
                subscribe: 1,
            });
        } catch (sendError) {
            setError(
                'Impossible d’envoyer la demande EUR/USD.'
            );
        }

        return () => {
            active = false;

            if (
                typeof unsubscribe ===
                'function'
            ) {
                unsubscribe();
            }
        };
    }, []);

    /*
     * =========================================================
     * CALCULS AFFICHAGE
     * =========================================================
     */

    const totalTests =
        stats.tests;

    const winRate =
        totalTests > 0
            ? (stats.wins /
                  totalTests) *
              100
            : 0;

    const lossRate =
        totalTests > 0
            ? (stats.losses /
                  totalTests) *
              100
            : 0;

    const averageBlock =
        blocks.length > 0
            ? blocks.reduce(
                  (sum, value) =>
                      sum + value,
                  0
              ) / blocks.length
            : 0;

    const minimumBlock =
        blocks.length > 0
            ? Math.min(...blocks)
            : 0;

    const maximumBlock =
        blocks.length > 0
            ? Math.max(...blocks)
            : 0;

    const currentRow =
        matrix[currentDirection];

    const rowTotal =
        currentRow.UP +
        currentRow.DOWN +
        currentRow.FLAT;

    const displayPrice =
        price !== null
            ? price.toFixed(5)
            : '—';

    return (
        <div
            style={{
                background:
                    '#ffffff',
                color: '#111111',
                padding: '20px',
                margin: '16px',
                borderRadius: '12px',
                fontFamily:
                    'Arial, sans-serif',
                lineHeight: 1.45,
            }}
        >
            <h2>
                Moniteur Forex EUR/USD —
                V4.1 Paper Trader
            </h2>

            <div>
                <strong>
                    Connexion :
                </strong>{' '}
                {connected ? (
                    '🟢 Connecté à Deriv — EUR/USD'
                ) : (
                    '🟠 Connexion à Deriv…'
                )}
            </div>

            {error && (
                <div
                    style={{
                        marginTop: 8,
                        padding: 10,
                        background:
                            '#ffe5e5',
                        borderRadius: 8,
                        color: '#b00000',
                    }}
                >
                    ❌ {error}
                </div>
            )}

            <div>
                <strong>
                    Marché :
                </strong>{' '}
                {MARKET_NAME}
            </div>

            <div>
                <strong>
                    Symbole :
                </strong>{' '}
                {MARKET_SYMBOL}
            </div>

            <div>
                <strong>
                    Prix :
                </strong>{' '}
                {displayPrice}
            </div>

            <hr />

            <h3>
                Phase 1 —
                Apprentissage
            </h3>

            <div>
                <strong>
                    Historique :
                </strong>{' '}
                {historyCount} /{' '}
                {HISTORY_SIZE}
            </div>

            {historyCount >=
            HISTORY_SIZE ? (
                <div>
                    ✅ 500 ticks
                    historiques
                    analysés.
                </div>
            ) : (
                <div>
                    ⏳ Collecte des
                    données…
                </div>
            )}

            <hr />

            <h3>
                Analyse des
                transitions
            </h3>

            <div>
                <strong>
                    Direction actuelle :
                </strong>{' '}
                {directionLabel(
                    currentDirection
                )}
            </div>

            <div>
                <strong>
                    Prédiction suivante :
                </strong>{' '}
                {prediction
                    ? directionLabel(
                          prediction
                      )
                    : '⏳ —'}
            </div>

            <div>
                <strong>
                    Force du signal :
                </strong>{' '}
                {prediction
                    ? `${predictionStrength.toFixed(
                          1
                      )} %`
                    : '—'}
            </div>

            <div>
                <strong>
                    Observations :
                </strong>{' '}
                {rowTotal}
            </div>

            <h3>
                Matrice de transitions
            </h3>

            <div
                style={{
                    fontSize: 13,
                }}
            >
                Ligne = direction
                actuelle →
                colonne = direction
                suivante.
            </div>

            <table
                style={{
                    width: '100%',
                    borderCollapse:
                        'collapse',
                    marginTop: 10,
                }}
            >
                <thead>
                    <tr>
                        <th
                            style={{
                                border:
                                    '1px solid #ccc',
                                padding: 8,
                            }}
                        >
                            →
                        </th>
                        <th
                            style={{
                                border:
                                    '1px solid #ccc',
                                padding: 8,
                            }}
                        >
                            HAUSSE
                        </th>
                        <th
                            style={{
                                border:
                                    '1px solid #ccc',
                                padding: 8,
                            }}
                        >
                            BAISSE
                        </th>
                        <th
                            style={{
                                border:
                                    '1px solid #ccc',
                                padding: 8,
                            }}
                        >
                            STABLE
                        </th>
                    </tr>
                </thead>

                <tbody>
                    <tr>
                        <td
                            style={{
                                border:
                                    '1px solid #ccc',
                                padding: 8,
                            }}
                        >
                            🟢 HAUSSE
                        </td>
                        <td
                            style={{
                                border:
                                    '1px solid #ccc',
                                padding: 8,
                                textAlign:
                                    'center',
                            }}
                        >
                            {matrix.UP.UP}
                        </td>
                        <td
                            style={{
                                border:
                                    '1px solid #ccc',
                                padding: 8,
                                textAlign:
                                    'center',
                            }}
                        >
                            {matrix.UP.DOWN}
                        </td>
                        <td
                            style={{
                                border:
                                    '1px solid #ccc',
                                padding: 8,
                                textAlign:
                                    'center',
                            }}
                        >
                            {matrix.UP.FLAT}
                        </td>
                    </tr>

                    <tr>
                        <td
                            style={{
                                border:
                                    '1px solid #ccc',
                                padding: 8,
                            }}
                        >
                            🔴 BAISSE
                        </td>
                        <td
                            style={{
                                border:
                                    '1px solid #ccc',
                                padding: 8,
                                textAlign:
                                    'center',
                            }}
                        >
                            {matrix.DOWN.UP}
                        </td>
                        <td
                            style={{
                                border:
                                    '1px solid #ccc',
                                padding: 8,
                                textAlign:
                                    'center',
                            }}
                        >
                            {matrix.DOWN.DOWN}
                        </td>
                        <td
                            style={{
                                border:
                                    '1px solid #ccc',
                                padding: 8,
                                textAlign:
                                    'center',
                            }}
                        >
                            {matrix.DOWN.FLAT}
                        </td>
                    </tr>

                    <tr>
                        <td
                            style={{
                                border:
                                    '1px solid #ccc',
                                padding: 8,
                            }}
                        >
                            ⚪ STABLE
                        </td>
                        <td
                            style={{
                                border:
                                    '1px solid #ccc',
                                padding: 8,
                                textAlign:
                                    'center',
                            }}
                        >
                            {matrix.FLAT.UP}
                        </td>
                        <td
                            style={{
                                border:
                                    '1px solid #ccc',
                                padding: 8,
                                textAlign:
                                    'center',
                            }}
                        >
                            {matrix.FLAT.DOWN}
                        </td>
                        <td
                            style={{
                                border:
                                    '1px solid #ccc',
                                padding: 8,
                                textAlign:
                                    'center',
                            }}
                        >
                            {matrix.FLAT.FLAT}
                        </td>
                    </tr>
                </tbody>
            </table>

            <hr />

            <h3>
                Phase 2 —
                Paper Trading
            </h3>

            <div>
                <strong>
                    Tests :
                </strong>{' '}
                {stats.tests} /{' '}
                {PAPER_TEST_LIMIT}
            </div>

            <div>
                🟢{' '}
                <strong>
                    Trades gagnants :
                </strong>{' '}
                {stats.wins}
            </div>

            <div>
                🔴{' '}
                <strong>
                    Trades perdants :
                </strong>{' '}
                {stats.losses}
            </div>

            <div>
                ⚪{' '}
                <strong>
                    Signaux ignorés :
                </strong>{' '}
                {stats.skipped}
            </div>

            <div>
                <strong>
                    Taux de réussite :
                </strong>{' '}
                {winRate.toFixed(2)} %
            </div>

            <div>
                <strong>
                    Taux d'échec :
                </strong>{' '}
                {lossRate.toFixed(2)} %
            </div>

            <div>
                <strong>
                    Résultat virtuel :
                </strong>{' '}
                {stats.virtualProfit >=
                0
                    ? '+'
                    : ''}
                {stats.virtualProfit}
            </div>

            <div
                style={{
                    marginTop: 10,
                    padding: 10,
                    background:
                        '#f3f3f3',
                    borderRadius: 8,
                }}
            >
                💰 1 gain =
                +1 virtuel
                <br />
                💸 1 perte =
                -1 virtuel
                <br />
                🚫 Aucun argent
                réel engagé.
            </div>

            <hr />

            <h3>
                📊 Blocs de 100
            </h3>

            <div>
                <strong>
                    Blocs terminés :
                </strong>{' '}
                {blocks.length}
            </div>

            {blocks.map(
                (rate, index) => (
                    <div
                        key={index}
                    >
                        Bloc {index + 1} :
                        {' '}
                        {rate.toFixed(
                            1
                        )}{' '}
                        %
                    </div>
                )
            )}

            <div
                style={{
                    marginTop: 8,
                }}
            >
                <strong>
                    Moyenne :
                </strong>{' '}
                {averageBlock.toFixed(
                    2
                )}{' '}
                %
            </div>

            <div>
                <strong>
                    Minimum :
                </strong>{' '}
                {minimumBlock.toFixed(
                    2
                )}{' '}
                %
            </div>

            <div>
                <strong>
                    Maximum :
                </strong>{' '}
                {maximumBlock.toFixed(
                    2
                )}{' '}
                %
            </div>

            <hr />

            {phase ===
            'done' ? (
                <div>
                    ✅ Paper test
                    terminé.
                    <br />
                    📌 {stats.wins}{' '}
                    gains /{' '}
                    {stats.losses}{' '}
                    pertes.
                    <br />
                    📈 Taux final :{' '}
                    {winRate.toFixed(
                        2
                    )}{' '}
                    %
                    <br />
                    💰 Résultat virtuel :{' '}
                    {stats.virtualProfit >=
                    0
                        ? '+'
                        : ''}
                    {
                        stats.virtualProfit
                    }
                </div>
            ) : (
                <div>
                    🔬 Paper
                    trading
                    uniquement.
                    <br />
                    ⚠️ Aucun taux
                    de réussite
                    n'est garanti.
                </div>
            )}

            <div
                style={{
                    marginTop: 8,
                }}
            >
                ❌{' '}
                <strong>
                    Aucun trade
                    automatique
                    réel.
                </strong>
            </div>
        </div>
    );
}

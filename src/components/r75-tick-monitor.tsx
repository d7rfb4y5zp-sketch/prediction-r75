import React, { useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';

const MARKET_SYMBOL = 'frxEURUSD';
const MARKET_NAME = 'EUR/USD';

const HISTORY_SIZE = 500;
const TEST_LIMIT = 500;
const BLOCK_SIZE = 100;

type Direction = 'UP' | 'DOWN' | 'FLAT';

const getDirection = (
    previous: number,
    current: number
): Direction => {
    if (current > previous) {
        return 'UP';
    }

    if (current < previous) {
        return 'DOWN';
    }

    return 'FLAT';
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

    if (direction === 'FLAT') {
        return '⚪ STABLE';
    }

    return '—';
};

const R75TickMonitor = () => {
    const [status, setStatus] = useState(
        '🟠 Connexion à Deriv…'
    );

    const [price, setPrice] = useState('—');

    const [history, setHistory] = useState<number[]>(
        []
    );

    const [tests, setTests] = useState(0);
    const [successes, setSuccesses] = useState(0);

    const [blockResults, setBlockResults] = useState<
        number[]
    >([]);

    const [
        currentBlockSuccess,
        setCurrentBlockSuccess,
    ] = useState(0);

    const historyRef = useRef<number[]>([]);

    const predictionRef =
        useRef<Direction | null>(null);

    const previousPriceRef =
        useRef<number | null>(null);

    const testsRef = useRef(0);
    const successesRef = useRef(0);

    const currentBlockSuccessRef = useRef(0);

    const blockResultsRef = useRef<number[]>([]);

    useEffect(() => {
        let subscription: any;

        const connect = () => {
            try {
                if (!api_base.api) {
                    setStatus(
                        '🔴 API Deriv non disponible'
                    );
                    return;
                }

                setStatus(
                    `🟢 Connecté à Deriv — ${MARKET_NAME}`
                );

                subscription = api_base.api
                    .onMessage()
                    .subscribe(({ data }: any) => {
                        if (
                            data?.msg_type !==
                            'tick'
                        ) {
                            return;
                        }

                        const tick =
                            data.tick;

                        if (
                            !tick ||
                            tick.symbol !==
                                MARKET_SYMBOL
                        ) {
                            return;
                        }

                        const quote = Number(
                            tick.quote
                        );

                        if (
                            !Number.isFinite(
                                quote
                            )
                        ) {
                            return;
                        }

                        const pipSize = Number(
                            tick.pip_size ??
                                5
                        );

                        const formattedPrice =
                            quote.toFixed(
                                pipSize
                            );

                        setPrice(
                            formattedPrice
                        );

                        const oldHistory =
                            historyRef.current;

                        /*
                         * =============================================
                         * PREMIER TICK
                         * =============================================
                         */

                        if (
                            previousPriceRef.current ===
                            null
                        ) {
                            previousPriceRef.current =
                                quote;

                            historyRef.current = [
                                quote,
                            ];

                            setHistory([
                                quote,
                            ]);

                            return;
                        }

                        /*
                         * =============================================
                         * DIRECTION DU TICK ACTUEL
                         * =============================================
                         */

                        const previousPrice =
                            previousPriceRef.current;

                        const actualDirection =
                            getDirection(
                                previousPrice,
                                quote
                            );

                        /*
                         * =============================================
                         * PHASE 1
                         * APPRENTISSAGE
                         * =============================================
                         */

                        if (
                            oldHistory.length <
                            HISTORY_SIZE
                        ) {
                            const nextHistory = [
                                ...oldHistory,
                                quote,
                            ];

                            historyRef.current =
                                nextHistory;

                            setHistory([
                                ...nextHistory,
                            ]);

                            previousPriceRef.current =
                                quote;

                            predictionRef.current =
                                null;

                            return;
                        }

                        /*
                         * =============================================
                         * PHASE 2
                         * TEST
                         * =============================================
                         */

                        if (
                            testsRef.current <
                                TEST_LIMIT &&
                            predictionRef.current !==
                                null
                        ) {
                            const prediction =
                                predictionRef.current;

                            testsRef.current += 1;

                            setTests(
                                testsRef.current
                            );

                            if (
                                prediction ===
                                actualDirection
                            ) {
                                successesRef.current +=
                                    1;

                                currentBlockSuccessRef.current +=
                                    1;

                                setSuccesses(
                                    successesRef.current
                                );

                                setCurrentBlockSuccess(
                                    currentBlockSuccessRef.current
                                );
                            }

                            /*
                             * FIN DU BLOC
                             */

                            if (
                                testsRef.current %
                                    BLOCK_SIZE ===
                                0
                            ) {
                                const result =
                                    currentBlockSuccessRef.current;

                                blockResultsRef.current =
                                    [
                                        ...blockResultsRef.current,
                                        result,
                                    ];

                                setBlockResults([
                                    ...blockResultsRef.current,
                                ]);

                                currentBlockSuccessRef.current =
                                    0;

                                setCurrentBlockSuccess(
                                    0
                                );
                            }
                        }

                        /*
                         * =============================================
                         * AJOUT DU PRIX À L'HISTORIQUE
                         * =============================================
                         */

                        const nextHistory = [
                            ...oldHistory,
                            quote,
                        ];

                        if (
                            nextHistory.length >
                            HISTORY_SIZE
                        ) {
                            nextHistory.shift();
                        }

                        historyRef.current =
                            nextHistory;

                        setHistory([
                            ...nextHistory,
                        ]);

                        previousPriceRef.current =
                            quote;

                        /*
                         * =============================================
                         * FIN DU TEST
                         * =============================================
                         */

                        if (
                            testsRef.current >=
                            TEST_LIMIT
                        ) {
                            predictionRef.current =
                                null;

                            return;
                        }

                        /*
                         * =============================================
                         * ANALYSE DES TRANSITIONS
                         *
                         * UP -> UP
                         * UP -> DOWN
                         * UP -> FLAT
                         *
                         * DOWN -> UP
                         * DOWN -> DOWN
                         * DOWN -> FLAT
                         *
                         * FLAT -> UP
                         * FLAT -> DOWN
                         * FLAT -> FLAT
                         * =============================================
                         */

                        const transitionMatrix: Record<
                            Direction,
                            Record<
                                Direction,
                                number
                            >
                        > = {
                            UP: {
                                UP: 0,
                                DOWN: 0,
                                FLAT: 0,
                            },

                            DOWN: {
                                UP: 0,
                                DOWN: 0,
                                FLAT: 0,
                            },

                            FLAT: {
                                UP: 0,
                                DOWN: 0,
                                FLAT: 0,
                            },
                        };

                        const directions: Direction[] =
                            [];

                        for (
                            let i = 1;
                            i <
                            nextHistory.length;
                            i++
                        ) {
                            const previous =
                                nextHistory[
                                    i - 1
                                ];

                            const current =
                                nextHistory[i];

                            directions.push(
                                getDirection(
                                    previous,
                                    current
                                )
                            );
                        }

                        for (
                            let i = 0;
                            i <
                            directions.length -
                                1;
                            i++
                        ) {
                            const from =
                                directions[i];

                            const to =
                                directions[i + 1];

                            transitionMatrix[
                                from
                            ][to]++;
                        }

                        /*
                         * =============================================
                         * DIRECTION ACTUELLE
                         * =============================================
                         */

                        const currentDirection =
                            actualDirection;

                        const row =
                            transitionMatrix[
                                currentDirection
                            ];

                        /*
                         * =============================================
                         * CHOIX DE LA PROCHAINE DIRECTION
                         * =============================================
                         */

                        let bestDirection: Direction =
                            'UP';

                        let highestCount =
                            row.UP;

                        if (
                            row.DOWN >
                            highestCount
                        ) {
                            highestCount =
                                row.DOWN;

                            bestDirection =
                                'DOWN';
                        }

                        if (
                            row.FLAT >
                            highestCount
                        ) {
                            highestCount =
                                row.FLAT;

                            bestDirection =
                                'FLAT';
                        }

                        predictionRef.current =
                            bestDirection;
                    });

                /*
                 * =============================================
                 * SOUSCRIPTION EUR/USD
                 * =============================================
                 */

                api_base.api.send({
                    ticks: MARKET_SYMBOL,
                    subscribe: 1,
                });
            } catch (error) {
                console.error(
                    'Forex V4 error:',
                    error
                );

                setStatus(
                    '🔴 Erreur Deriv'
                );
            }
        };

        connect();

        return () => {
            if (subscription) {
                subscription.unsubscribe();
            }
        };
    }, []);

    /*
     * =============================================
     * MATRICE D'AFFICHAGE
     * =============================================
     */

    const displayMatrix: Record<
        Direction,
        Record<Direction, number>
    > = {
        UP: {
            UP: 0,
            DOWN: 0,
            FLAT: 0,
        },

        DOWN: {
            UP: 0,
            DOWN: 0,
            FLAT: 0,
        },

        FLAT: {
            UP: 0,
            DOWN: 0,
            FLAT: 0,
        },
    };

    const displayDirections: Direction[] =
        [];

    for (
        let i = 1;
        i < history.length;
        i++
    ) {
        displayDirections.push(
            getDirection(
                history[i - 1],
                history[i]
            )
        );
    }

    for (
        let i = 0;
        i <
        displayDirections.length - 1;
        i++
    ) {
        const from =
            displayDirections[i];

        const to =
            displayDirections[i + 1];

        displayMatrix[from][to]++;
    }

    const currentDirection =
        displayDirections.length > 0
            ? displayDirections[
                  displayDirections.length - 1
              ]
            : null;

    const currentRow =
        currentDirection !== null
            ? displayMatrix[
                  currentDirection
              ]
            : {
                  UP: 0,
                  DOWN: 0,
                  FLAT: 0,
              };

    const transitionTotal =
        currentRow.UP +
        currentRow.DOWN +
        currentRow.FLAT;

    let displayedPrediction: Direction =
        'UP';

    let displayedHighest =
        currentRow.UP;

    if (
        currentRow.DOWN >
        displayedHighest
    ) {
        displayedHighest =
            currentRow.DOWN;

        displayedPrediction =
            'DOWN';
    }

    if (
        currentRow.FLAT >
        displayedHighest
    ) {
        displayedHighest =
            currentRow.FLAT;

        displayedPrediction =
            'FLAT';
    }

    const predictionFrequency =
        transitionTotal > 0
            ? (
                  (displayedHighest /
                      transitionTotal) *
                  100
              ).toFixed(1)
            : '0.0';

    /*
     * =============================================
     * STATISTIQUES
     * =============================================
     */

    const testRate =
        tests > 0
            ? (
                  (successes / tests) *
                  100
              ).toFixed(1)
            : '0.0';

    const completedBlocks =
        blockResults.length;

    const blockAverage =
        completedBlocks > 0
            ? (
                  blockResults.reduce(
                      (
                          sum,
                          value
                      ) =>
                          sum + value,
                      0
                  ) /
                  completedBlocks
              ).toFixed(2)
            : '—';

    const minBlock =
        completedBlocks > 0
            ? Math.min(
                  ...blockResults
              )
            : '—';

    const maxBlock =
        completedBlocks > 0
            ? Math.max(
                  ...blockResults
              )
            : '—';

    return (
        <div
            style={{
                padding: '15px',
                margin: '10px 0',
                background:
                    '#ffffff',
                color: '#000000',
                borderRadius:
                    '10px',
            }}
        >
            <h2>
                Moniteur Forex EUR/USD — V4
            </h2>

            <p>
                <strong>
                    Connexion :
                </strong>{' '}
                {status}
            </p>

            <p>
                <strong>
                    Marché :
                </strong>{' '}
                {MARKET_NAME}
            </p>

            <p>
                <strong>
                    Symbole :
                </strong>{' '}
                {MARKET_SYMBOL}
            </p>

            <p>
                <strong>
                    Prix :
                </strong>{' '}
                {price}
            </p>

            <hr />

            <h3>
                Phase 1 — Apprentissage
            </h3>

            <p>
                <strong>
                    Historique :
                </strong>{' '}
                {history.length} /{' '}
                {HISTORY_SIZE}
            </p>

            {history.length <
            HISTORY_SIZE ? (
                <p>
                    📊 Collecte des 500
                    ticks EUR/USD...
                </p>
            ) : (
                <>
                    <p>
                        ✅ 500 ticks
                        collectés.
                    </p>

                    <hr />

                    <h3>
                        Analyse des transitions
                    </h3>

                    <p>
                        <strong>
                            Direction actuelle :
                        </strong>{' '}
                        {directionLabel(
                            currentDirection
                        )}
                    </p>

                    <p>
                        <strong>
                            Observations :
                        </strong>{' '}
                        {transitionTotal}
                    </p>

                    <p>
                        <strong>
                            Transition dominante :
                        </strong>{' '}
                        {directionLabel(
                            displayedPrediction
                        )}
                    </p>

                    <p>
                        <strong>
                            Occurrences :
                        </strong>{' '}
                        {displayedHighest}
                    </p>

                    <p>
                        <strong>
                            Fréquence :
                        </strong>{' '}
                        {predictionFrequency}%
                    </p>

                    <hr />

                    <h3>
                        Matrice des transitions
                    </h3>

                    <p>
                        Ligne = direction
                        actuelle → colonne =
                        direction suivante.
                    </p>

                    <div
                        style={{
                            overflowX:
                                'auto',
                        }}
                    >
                        <table
                            style={{
                                borderCollapse:
                                    'collapse',
                                width:
                                    '100%',
                                minWidth:
                                    '500px',
                            }}
                        >
                            <thead>
                                <tr>
                                    <th
                                        style={{
                                            border:
                                                '1px solid #ccc',
                                            padding:
                                                '6px',
                                        }}
                                    >
                                        →
                                    </th>

                                    <th
                                        style={{
                                            border:
                                                '1px solid #ccc',
                                            padding:
                                                '6px',
                                        }}
                                    >
                                        HAUSSE
                                    </th>

                                    <th
                                        style={{
                                            border:
                                                '1px solid #ccc',
                                            padding:
                                                '6px',
                                        }}
                                    >
                                        BAISSE
                                    </th>

                                    <th
                                        style={{
                                            border:
                                                '1px solid #ccc',
                                            padding:
                                                '6px',
                                        }}
                                    >
                                        STABLE
                                    </th>
                                </tr>
                            </thead>

                            <tbody>
                                {(
                                    [
                                        'UP',
                                        'DOWN',
                                        'FLAT',
                                    ] as Direction[]
                                ).map(
                                    from => (
                                        <tr
                                            key={
                                                from
                                            }
                                        >
                                            <th
                                                style={{
                                                    border:
                                                        '1px solid #ccc',
                                                    padding:
                                                        '6px',
                                                }}
                                            >
                                                {directionLabel(
                                                    from
                                                )}
                                            </th>

                                            <td
                                                style={{
                                                    border:
                                                        '1px solid #ccc',
                                                    padding:
                                                        '6px',
                                                    textAlign:
                                                        'center',
                                                }}
                                            >
                                                {
                                                    displayMatrix[
                                                        from
                                                    ]
                                                        .UP
                                                }
                                            </td>

                                            <td
                                                style={{
                                                    border:
                                                        '1px solid #ccc',
                                                    padding:
                                                        '6px',
                                                    textAlign:
                                                        'center',
                                                }}
                                            >
                                                {
                                                    displayMatrix[
                                                        from
                                                    ]
                                                        .DOWN
                                                }
                                            </td>

                                            <td
                                                style={{
                                                    border:
                                                        '1px solid #ccc',
                                                    padding:
                                                        '6px',
                                                    textAlign:
                                                        'center',
                                                }}
                                            >
                                                {
                                                    displayMatrix[
                                                        from
                                                    ]
                                                        .FLAT
                                                }
                                            </td>
                                        </tr>
                                    )
                                )}
                            </tbody>
                        </table>
                    </div>

                    <hr />

                    <h3>
                        Phase 2 — Validation
                    </h3>

                    <p>
                        <strong>
                            Tests réalisés :
                        </strong>{' '}
                        {tests} /{' '}
                        {TEST_LIMIT}
                    </p>

                    <p>
                        <strong>
                            Réussites :
                        </strong>{' '}
                        {successes}
                    </p>

                    <p>
                        <strong>
                            Échecs :
                        </strong>{' '}
                        {tests - successes}
                    </p>

                    <p>
                        <strong>
                            Taux observé :
                        </strong>{' '}
                        {testRate}%
                    </p>

                    <p>
                        📌 Les résultats sont
                        expérimentaux. Aucun
                        taux de réussite n'est
                        garanti.
                    </p>

                    <hr />

                    <h3>
                        📊 Blocs de 100
                    </h3>

                    <p>
                        <strong>
                            Blocs terminés :
                        </strong>{' '}
                        {completedBlocks}
                    </p>

                    {blockResults.map(
                        (
                            value,
                            index
                        ) => (
                            <p
                                key={
                                    index
                                }
                            >
                                <strong>
                                    Bloc{' '}
                                    {index +
                                        1}
                                    :
                                </strong>{' '}
                                {value} / 100 (
                                {value.toFixed(
                                    1
                                )}
                                %)
                            </p>
                        )
                    )}

                    {tests %
                        BLOCK_SIZE !==
                        0 &&
                        tests > 0 && (
                            <p>
                                🔄 Bloc actuel :
                                {' '}
                                {
                                    currentBlockSuccess
                                }{' '}
                                réussite(s)
                                sur{' '}
                                {tests %
                                    BLOCK_SIZE}{' '}
                                test(s).
                            </p>
                        )}

                    {completedBlocks >
                        0 && (
                        <>
                            <hr />

                            <p>
                                <strong>
                                    Moyenne :
                                </strong>{' '}
                                {
                                    blockAverage
                                }{' '}
                                / 100
                            </p>

                            <p>
                                <strong>
                                    Minimum :
                                </strong>{' '}
                                {
                                    minBlock
                                }{' '}
                                / 100
                            </p>

                            <p>
                                <strong>
                                    Maximum :
                                </strong>{' '}
                                {
                                    maxBlock
                                }{' '}
                                / 100
                            </p>
                        </>
                    )}

                    {tests >=
                        TEST_LIMIT && (
                        <>
                            <hr />

                            <p>
                                ✅ Validation de
                                500 ticks
                                terminée.
                            </p>

                            <p>
                                🧪 Le système
                                reste en mode
                                analyse.
                            </p>
                        </>
                    )}

                    <hr />

                    <p>
                        ⚠️ Test statistique
                        uniquement.
                    </p>

                    <p>
                        ❌ Aucun trade
                        automatique.
                    </p>
                </>
            )}
        </div>
    );
};

export default R75TickMonitor;

import React, { useEffect, useRef, useState } from 'react';
import { api_base } from '../external/bot-skeleton';

const MARKET_SYMBOL = 'frxEURUSD';
const MARKET_NAME = 'EUR/USD';

const HISTORY_SIZE = 500;
const PAPER_TEST_LIMIT = 1000;
const BLOCK_SIZE = 100;

const VIRTUAL_STAKE = 1.0;
const VIRTUAL_WIN = 0.80;
const VIRTUAL_LOSS = 1.0;

type Direction = 'UP' | 'DOWN' | 'FLAT';

type Tick = {
    symbol?: string;
    quote?: number;
    epoch?: number;
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

type Stats = {
    tests: number;
    wins: number;
    losses: number;
    skipped: number;
    virtualProfit: number;
};

const createEmptyMatrix = (): Matrix => ({
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
});

const directionLabel = (direction: Direction) => {
    if (direction === 'UP') {
        return '🟢 HAUSSE';
    }

    if (direction === 'DOWN') {
        return '🔴 BAISSE';
    }

    return '⚪ STABLE';
};

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

const addTransition = (
    matrix: Matrix,
    from: Direction,
    to: Direction
) => {
    matrix[from][to] += 1;
};

const calculatePrediction = (
    matrix: Matrix,
    current: Direction
) => {
    const row = matrix[current];

    const up = row.UP;
    const down = row.DOWN;

    /*
     * IMPORTANT :
     *
     * FLAT n'est pas utilisé comme signal.
     * Nous cherchons uniquement UP ou DOWN.
     */
    const directionalTotal = up + down;

    if (directionalTotal === 0) {
        return {
            direction: null as Direction | null,
            strength: 0,
            observations: 0,
        };
    }

    if (up >= down) {
        return {
            direction: 'UP' as Direction,
            strength: (up / directionalTotal) * 100,
            observations: directionalTotal,
        };
    }

    return {
        direction: 'DOWN' as Direction,
        strength: (down / directionalTotal) * 100,
        observations: directionalTotal,
    };
};

export default function R75TickMonitor() {
    const [connected, setConnected] =
        useState(false);

    const [status, setStatus] = useState(
        '🟠 Connexion à Deriv…'
    );

    const [price, setPrice] =
        useState<number | null>(null);

    const [historyCount, setHistoryCount] =
        useState(0);

    const [phase, setPhase] = useState<
        'learning' | 'testing' | 'done'
    >('learning');

    const [currentDirection, setCurrentDirection] =
        useState<Direction>('FLAT');

    const [prediction, setPrediction] =
        useState<Direction | null>(null);

    const [predictionStrength, setPredictionStrength] =
        useState(0);

    const [observations, setObservations] =
        useState(0);

    const [matrix, setMatrix] =
        useState<Matrix>(createEmptyMatrix());

    const [stats, setStats] = useState<Stats>({
        tests: 0,
        wins: 0,
        losses: 0,
        skipped: 0,
        virtualProfit: 0,
    });

    const [blocks, setBlocks] =
        useState<number[]>([]);

    const [currentBlockWins, setCurrentBlockWins] =
        useState(0);

    const [currentBlockTests, setCurrentBlockTests] =
        useState(0);

    const [errorMessage, setErrorMessage] =
        useState('');

    /*
     * ============================================================
     * REFS
     * ============================================================
     */

    const previousPriceRef =
        useRef<number | null>(null);

    const previousEpochRef =
        useRef<number | null>(null);

    const historyRef =
        useRef<Direction[]>([]);

    const matrixRef =
        useRef<Matrix>(createEmptyMatrix());

    /*
     * La prédiction produite après un tick.
     *
     * Elle sera vérifiée au tick suivant.
     */
    const predictionRef =
        useRef<Direction | null>(null);

    const testsRef =
        useRef(0);

    const winsRef =
        useRef(0);

    const lossesRef =
        useRef(0);

    const skippedRef =
        useRef(0);

    const virtualProfitRef =
        useRef(0);

    const blockWinsRef =
        useRef(0);

    const blockTestsRef =
        useRef(0);

    const historyReadyRef =
        useRef(false);

    const activeRef =
        useRef(true);

    /*
     * ============================================================
     * FONCTION : METTRE À JOUR LES STATISTIQUES
     * ============================================================
     */

    const refreshStats = () => {
        setStats({
            tests: testsRef.current,
            wins: winsRef.current,
            losses: lossesRef.current,
            skipped: skippedRef.current,
            virtualProfit:
                virtualProfitRef.current,
        });

        setCurrentBlockWins(
            blockWinsRef.current
        );

        setCurrentBlockTests(
            blockTestsRef.current
        );
    };

    /*
     * ============================================================
     * FONCTION : TRAITER UN NOUVEAU TICK
     * ============================================================
     */

    const processLiveTick = (tick: Tick) => {
        if (!activeRef.current) {
            return;
        }

        if (
            tick.symbol &&
            tick.symbol !== MARKET_SYMBOL
        ) {
            return;
        }

        const quote = Number(tick.quote);

        if (!Number.isFinite(quote)) {
            return;
        }

        const epoch =
            tick.epoch !== undefined
                ? Number(tick.epoch)
                : null;

        /*
         * Éviter de traiter exactement deux fois
         * le même tick.
         */
        if (
            epoch !== null &&
            previousEpochRef.current === epoch
        ) {
            return;
        }

        if (epoch !== null) {
            previousEpochRef.current =
                epoch;
        }

        setConnected(true);
        setStatus(
            '🟢 Connecté à Deriv — EUR/USD'
        );
        setPrice(quote);
        setErrorMessage('');

        /*
         * Premier tick du flux.
         */
        if (
            previousPriceRef.current === null
        ) {
            previousPriceRef.current =
                quote;

            return;
        }

        const previousPrice =
            previousPriceRef.current;

        const direction =
            getDirection(
                previousPrice,
                quote
            );

        previousPriceRef.current =
            quote;

        setCurrentDirection(
            direction
        );

        /*
         * ========================================================
         * PHASE 2
         *
         * Le premier nouveau tick après les 500
         * permet d'établir une nouvelle transition.
         *
         * Avant de créer la nouvelle prédiction,
         * on vérifie celle du tick précédent.
         * ========================================================
         */

        if (
            historyReadyRef.current &&
            predictionRef.current !== null &&
            testsRef.current <
                PAPER_TEST_LIMIT
        ) {
            const predicted =
                predictionRef.current;

            /*
             * Une prédiction UP/DOWN est vérifiée
             * uniquement contre UP/DOWN.
             *
             * Si le marché est FLAT :
             * signal ignoré.
             */
            if (
                direction === 'FLAT'
            ) {
                skippedRef.current +=
                    1;

                refreshStats();
            } else {
                testsRef.current +=
                    1;

                blockTestsRef.current +=
                    1;

                /*
                 * GAIN
                 */
                if (
                    predicted ===
                    direction
                ) {
                    winsRef.current +=
                        1;

                    blockWinsRef.current +=
                        1;

                    virtualProfitRef.current +=
                        VIRTUAL_WIN;
                } else {
                    /*
                     * PERTE
                     */
                    lossesRef.current +=
                        1;

                    virtualProfitRef.current -=
                        VIRTUAL_LOSS;
                }

                /*
                 * Bloc de 100 trades.
                 */
                if (
                    blockTestsRef.current >=
                    BLOCK_SIZE
                ) {
                    const blockRate =
                        blockTestsRef.current >
                        0
                            ? (
                                  (blockWinsRef.current /
                                      blockTestsRef.current) *
                                  100
                              )
                            : 0;

                    setBlocks(
                        previous => [
                            ...previous,
                            blockRate,
                        ]
                    );

                    blockTestsRef.current =
                        0;

                    blockWinsRef.current =
                        0;
                }

                refreshStats();
            }

            /*
             * TEST TERMINÉ
             */
            if (
                testsRef.current >=
                PAPER_TEST_LIMIT
            ) {
                setPhase('done');

                predictionRef.current =
                    null;

                setPrediction(null);

                return;
            }
        }

        /*
         * ========================================================
         * CONSTRUCTION DE LA MATRICE EN TEMPS RÉEL
         * ========================================================
         */

        if (
            historyReadyRef.current
        ) {
            const history =
                historyRef.current;

            const previousDirection =
                history.length > 0
                    ? history[
                          history.length - 1
                      ]
                    : null;

            if (
                previousDirection !== null
            ) {
                addTransition(
                    matrixRef.current,
                    previousDirection,
                    direction
                );
            }

            /*
             * Historique roulant.
             */
            historyRef.current.push(
                direction
            );

            if (
                historyRef.current.length >
                HISTORY_SIZE
            ) {
                historyRef.current.shift();
            }

            setMatrix({
                ...matrixRef.current,
            });

            /*
             * ====================================================
             * NOUVELLE PRÉDICTION
             * ====================================================
             */

            const result =
                calculatePrediction(
                    matrixRef.current,
                    direction
                );

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
    };

    /*
     * ============================================================
     * CHARGEMENT DES 500 TICKS HISTORIQUES
     * ============================================================
     */

    const loadHistory = async () => {
        try {
            if (!api_base?.api) {
                throw new Error(
                    'API Deriv non disponible'
                );
            }

            setStatus(
                '🟠 Chargement des 500 ticks historiques…'
            );

            /*
             * Demande historique.
             *
             * subscribe: 0
             *
             * Important :
             * l'historique est récupéré une seule fois.
             */
            const response =
                await api_base.api.send({
                    ticks_history:
                        MARKET_SYMBOL,

                    end: 'latest',

                    count:
                        HISTORY_SIZE,

                    style: 'ticks',

                    subscribe: 0,
                });

            if (
                response?.error
            ) {
                throw new Error(
                    response.error.message ||
                        'Erreur ticks_history'
                );
            }

            const prices =
                response?.history?.prices;

            const times =
                response?.history?.times;

            if (
                !Array.isArray(prices) ||
                prices.length < 2
            ) {
                throw new Error(
                    'Historique EUR/USD insuffisant'
                );
            }

            /*
             * Utiliser au maximum les 500 derniers prix.
             */
            const usablePrices =
                prices.slice(
                    -HISTORY_SIZE
                );

            /*
             * Construire les directions.
             */
            const directions: Direction[] =
                [];

            const historicalMatrix =
                createEmptyMatrix();

            for (
                let i = 1;
                i < usablePrices.length;
                i++
            ) {
                const previous =
                    Number(
                        usablePrices[
                            i - 1
                        ]
                    );

                const current =
                    Number(
                        usablePrices[i]
                    );

                if (
                    !Number.isFinite(
                        previous
                    ) ||
                    !Number.isFinite(
                        current
                    )
                ) {
                    continue;
                }

                const direction =
                    getDirection(
                        previous,
                        current
                    );

                directions.push(
                    direction
                );

                if (
                    directions.length >=
                    2
                ) {
                    const from =
                        directions[
                            directions.length -
                                2
                        ];

                    const to =
                        directions[
                            directions.length -
                                1
                        ];

                    addTransition(
                        historicalMatrix,
                        from,
                        to
                    );
                }
            }

            if (
                directions.length <
                2
            ) {
                throw new Error(
                    'Impossible de construire les transitions'
                );
            }

            /*
             * Garder les 500 directions maximum.
             */
            historyRef.current =
                directions.slice(
                    -HISTORY_SIZE
                );

            matrixRef.current =
                historicalMatrix;

            setHistoryCount(
                historyRef.current.length
            );

            setMatrix({
                ...historicalMatrix,
            });

            /*
             * Dernier prix historique.
             */
            const lastPrice =
                Number(
                    usablePrices[
                        usablePrices.length -
                            1
                    ]
                );

            if (
                Number.isFinite(lastPrice)
            ) {
                previousPriceRef.current =
                    lastPrice;

                setPrice(lastPrice);
            }

            /*
             * Dernier epoch historique.
             */
            if (
                Array.isArray(times) &&
                times.length > 0
            ) {
                const lastEpoch =
                    Number(
                        times[
                            times.length -
                                1
                        ]
                    );

                if (
                    Number.isFinite(
                        lastEpoch
                    )
                ) {
                    previousEpochRef.current =
                        lastEpoch;
                }
            }

            /*
             * Dernière direction.
             */
            const lastDirection =
                historyRef.current[
                    historyRef.current.length -
                        1
                ];

            if (lastDirection) {
                setCurrentDirection(
                    lastDirection
                );

                const result =
                    calculatePrediction(
                        historicalMatrix,
                        lastDirection
                    );

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

            historyReadyRef.current =
                true;

            setPhase('testing');

            setStatus(
                '🟢 Connecté à Deriv — EUR/USD'
            );

            setConnected(true);
        } catch (error: any) {
            console.error(
                'V4.5 history error:',
                error
            );

            setConnected(false);

            setStatus(
                '🔴 Erreur chargement EUR/USD'
            );

            setErrorMessage(
                error?.message ||
                    'Erreur inconnue'
            );
        }
    };

    /*
     * ============================================================
     * CONNEXION + ABONNEMENT TEMPS RÉEL
     * ============================================================
     */

    useEffect(() => {
        activeRef.current = true;

        let subscription:
            | any
            | null = null;

        const start = async () => {
            try {
                if (!api_base?.api) {
                    setStatus(
                        '🔴 API Deriv non disponible'
                    );

                    return;
                }

                /*
                 * Écouter les messages Deriv.
                 *
                 * Cette forme correspond à l'api_base
                 * utilisée dans ton projet.
                 */
                subscription =
                    api_base.api
                        .onMessage()
                        .subscribe(
                            ({
                                data,
                            }: any) => {
                                if (
                                    !activeRef.current
                                ) {
                                    return;
                                }

                                /*
                                 * Erreur API.
                                 */
                                if (
                                    data?.error
                                ) {
                                    console.error(
                                        'Deriv API error:',
                                        data.error
                                    );

                                    setErrorMessage(
                                        data.error
                                            ?.message ||
                                            'Erreur Deriv'
                                    );

                                    return;
                                }

                                /*
                                 * Tick temps réel.
                                 */
                                if (
                                    data?.msg_type ===
                                    'tick'
                                ) {
                                    processLiveTick(
                                        data.tick
                                    );
                                }
                            }
                        );

                /*
                 * Charger d'abord
                 * les 500 ticks historiques.
                 */
                await loadHistory();

                if (
                    !activeRef.current
                ) {
                    return;
                }

                /*
                 * Puis abonnement temps réel.
                 */
                api_base.api.send({
                    ticks:
                        MARKET_SYMBOL,

                    subscribe: 1,
                });

                setStatus(
                    '🟢 Connecté à Deriv — EUR/USD'
                );

                setConnected(true);
            } catch (error: any) {
                console.error(
                    'V4.5 connection error:',
                    error
                );

                setConnected(false);

                setStatus(
                    '🔴 Erreur connexion Deriv'
                );

                setErrorMessage(
                    error?.message ||
                        'Impossible de démarrer le flux EUR/USD'
                );
            }
        };

        start();

        return () => {
            activeRef.current =
                false;

            if (
                subscription &&
                typeof subscription.unsubscribe ===
                    'function'
            ) {
                subscription.unsubscribe();
            }

            /*
             * On ne ferme pas l'API globale :
             * elle appartient à l'application Deriv.
             */
        };
    }, []);

    /*
     * ============================================================
     * STATISTIQUES AFFICHÉES
     * ============================================================
     */

    const tests =
        stats.tests;

    const winRate =
        tests > 0
            ? (stats.wins /
                  tests) *
              100
            : 0;

    const lossRate =
        tests > 0
            ? (stats.losses /
                  tests) *
              100
            : 0;

    const totalStaked =
        tests *
        VIRTUAL_STAKE;

    const averageBlock =
        blocks.length > 0
            ? blocks.reduce(
                  (sum, value) =>
                      sum + value,
                  0
              ) /
              blocks.length
            : 0;

    const minimumBlock =
        blocks.length > 0
            ? Math.min(...blocks)
            : 0;

    const maximumBlock =
        blocks.length > 0
            ? Math.max(...blocks)
            : 0;

    const rendement =
        totalStaked > 0
            ? (stats.virtualProfit /
                  totalStaked) *
              100
            : 0;

    const currentRow =
        matrix[
            currentDirection
        ];

    const rowTotal =
        currentRow.UP +
        currentRow.DOWN +
        currentRow.FLAT;

    const displayPrice =
        price !== null
            ? price.toFixed(5)
            : '—';

    /*
     * ============================================================
     * AFFICHAGE
     * ============================================================
     */

    return (
        <div
            style={{
                background:
                    '#111111',
                color:
                    '#ffffff',
                padding:
                    '20px',
                margin:
                    '16px',
                borderRadius:
                    '12px',
                fontFamily:
                    'Arial, sans-serif',
                lineHeight:
                    1.5,
            }}
        >
            <h2
                style={{
                    marginTop: 0,
                }}
            >
                Moniteur Forex EUR/USD —
                V4.5 Paper Trader
            </h2>

            <div
                style={{
                    padding:
                        '12px',
                    borderRadius:
                        '10px',
                    background:
                        connected
                            ? '#064d27'
                            : '#4d3300',
                    marginBottom:
                        '14px',
                }}
            >
                <strong>
                    Connexion :
                </strong>{' '}
                {status}
            </div>

            {errorMessage && (
                <div
                    style={{
                        padding:
                            '10px',
                        marginBottom:
                            '12px',
                        background:
                            '#5a1010',
                        borderRadius:
                            '8px',
                    }}
                >
                    ⚠️ {errorMessage}
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
                Phase 1 — Apprentissage
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
                    ✅ Base de 500 ticks
                    chargée.
                </div>
            ) : (
                <div>
                    ⏳ Chargement de
                    l'historique…
                </div>
            )}

            <hr />

            <h3>
                Analyse des transitions
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
                    Prédiction :
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
                    Observations UP/DOWN :
                </strong>{' '}
                {observations}
            </div>

            <div>
                <strong>
                    Observations totales :
                </strong>{' '}
                {rowTotal}
            </div>

            <h3>
                Matrice de transitions
            </h3>

            <div
                style={{
                    fontSize:
                        '13px',
                    marginBottom:
                        '8px',
                }}
            >
                Ligne = direction actuelle
                → colonne = direction suivante.
            </div>

            <div
                style={{
                    overflowX:
                        'auto',
                }}
            >
                <table
                    style={{
                        width:
                            '100%',
                        minWidth:
                            '520px',
                        borderCollapse:
                            'collapse',
                    }}
                >
                    <thead>
                        <tr>
                            <th
                                style={{
                                    border:
                                        '1px solid #555',
                                    padding:
                                        '8px',
                                }}
                            >
                                →
                            </th>

                            <th
                                style={{
                                    border:
                                        '1px solid #555',
                                    padding:
                                        '8px',
                                }}
                            >
                                🟢 HAUSSE
                            </th>

                            <th
                                style={{
                                    border:
                                        '1px solid #555',
                                    padding:
                                        '8px',
                                }}
                            >
                                🔴 BAISSE
                            </th>

                            <th
                                style={{
                                    border:
                                        '1px solid #555',
                                    padding:
                                        '8px',
                                }}
                            >
                                ⚪ STABLE
                            </th>
                        </tr>
                    </thead>

                    <tbody>
                        <tr>
                            <td
                                style={{
                                    border:
                                        '1px solid #555',
                                    padding:
                                        '8px',
                                }}
                            >
                                🟢 HAUSSE
                            </td>

                            <td
                                style={{
                                    border:
                                        '1px solid #555',
                                    padding:
                                        '8px',
                                    textAlign:
                                        'center',
                                }}
                            >
                                {matrix.UP.UP}
                            </td>

                            <td
                                style={{
                                    border:
                                        '1px solid #555',
                                    padding:
                                        '8px',
                                    textAlign:
                                        'center',
                                }}
                            >
                                {matrix.UP.DOWN}
                            </td>

                            <td
                                style={{
                                    border:
                                        '1px solid #555',
                                    padding:
                                        '8px',
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
                                        '1px solid #555',
                                    padding:
                                        '8px',
                                }}
                            >
                                🔴 BAISSE
                            </td>

                            <td
                                style={{
                                    border:
                                        '1px solid #555',
                                    padding:
                                        '8px',
                                    textAlign:
                                        'center',
                                }}
                            >
                                {matrix.DOWN.UP}
                            </td>

                            <td
                                style={{
                                    border:
                                        '1px solid #555',
                                    padding:
                                        '8px',
                                    textAlign:
                                        'center',
                                }}
                            >
                                {matrix.DOWN.DOWN}
                            </td>

                            <td
                                style={{
                                    border:
                                        '1px solid #555',
                                    padding:
                                        '8px',
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
                                        '1px solid #555',
                                    padding:
                                        '8px',
                                }}
                            >
                                ⚪ STABLE
                            </td>

                            <td
                                style={{
                                    border:
                                        '1px solid #555',
                                    padding:
                                        '8px',
                                    textAlign:
                                        'center',
                                }}
                            >
                                {matrix.FLAT.UP}
                            </td>

                            <td
                                style={{
                                    border:
                                        '1px solid #555',
                                    padding:
                                        '8px',
                                    textAlign:
                                        'center',
                                }}
                            >
                                {matrix.FLAT.DOWN}
                            </td>

                            <td
                                style={{
                                    border:
                                        '1px solid #555',
                                    padding:
                                        '8px',
                                    textAlign:
                                        'center',
                                }}
                            >
                                {matrix.FLAT.FLAT}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <hr />

            <h3>
                Phase 2 — Paper Trading
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
                    Succès :
                </strong>{' '}
                {stats.wins}
            </div>

            <div>
                🔴{' '}
                <strong>
                    Échecs :
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
                📊{' '}
                <strong>
                    Taux :
                </strong>{' '}
                {winRate.toFixed(
                    2
                )}
                %
            </div>

            <div>
                📉{' '}
                <strong>
                    Taux d'échec :
                </strong>{' '}
                {lossRate.toFixed(
                    2
                )}
                %
            </div>

            <hr />

            <h3>
                💰 Résultat Paper Trader
            </h3>

            <div>
                <strong>
                    Mise virtuelle :
                </strong>{' '}
                $
                {VIRTUAL_STAKE.toFixed(
                    2
                )}
            </div>

            <div>
                <strong>
                    Gain par succès :
                </strong>{' '}
                +$
                {VIRTUAL_WIN.toFixed(
                    2
                )}
            </div>

            <div>
                <strong>
                    Perte par échec :
                </strong>{' '}
                -$
                {VIRTUAL_LOSS.toFixed(
                    2
                )}
            </div>

            <div
                style={{
                    marginTop:
                        '14px',
                    fontSize:
                        '25px',
                    fontWeight:
                        'bold',
                }}
            >
                {stats.virtualProfit >=
                0
                    ? '🟢'
                    : '🔴'}{' '}
                Gain virtuel :{' '}
                {stats.virtualProfit >=
                0
                    ? '+'
                    : ''}
                $
                {stats.virtualProfit.toFixed(
                    2
                )}
            </div>

            <div
                style={{
                    marginTop:
                        '8px',
                }}
            >
                💵{' '}
                <strong>
                    Mise totale :
                </strong>{' '}
                $
                {totalStaked.toFixed(
                    2
                )}
            </div>

            <div>
                📈{' '}
                <strong>
                    Rendement :
                </strong>{' '}
                {rendement >=
                0
                    ? '+'
                    : ''}
                {rendement.toFixed(
                    2
                )}
                %
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
                (
                    rate,
                    index
                ) => (
                    <div
                        key={
                            index
                        }
                    >
                        Bloc{' '}
                        {index +
                            1}
                        :{' '}
                        {rate.toFixed(
                            1
                        )}
                        %
                    </div>
                )
            )}

            {stats.tests <
                PAPER_TEST_LIMIT &&
                currentBlockTests >
                    0 && (
                    <div
                        style={{
                            marginTop:
                                '8px',
                        }}
                    >
                        Bloc actuel :{' '}
                        {
                            currentBlockWins
                        }{' '}
                        /{' '}
                        {
                            currentBlockTests
                        }
                    </div>
                )}

            <div
                style={{
                    marginTop:
                        '10px',
                }}
            >
                <strong>
                    Moyenne :
                </strong>{' '}
                {averageBlock.toFixed(
                    2
                )}
                %
            </div>

            <div>
                <strong>
                    Minimum :
                </strong>{' '}
                {minimumBlock.toFixed(
                    2
                )}
                %
            </div>

            <div>
                <strong>
                    Maximum :
                </strong>{' '}
                {maximumBlock.toFixed(
                    2
                )}
                %
            </div>

            <hr />

            {phase ===
            'done' ? (
                <>
                    <div
                        style={{
                            padding:
                                '12px',
                            background:
                                '#064d27',
                            borderRadius:
                                '8px',
                        }}
                    >
                        ✅{' '}
                        <strong>
                            Paper test de
                            1000 trades
                            terminé.
                        </strong>
                    </div>

                    <div
                        style={{
                            marginTop:
                                '10px',
                        }}
                    >
                        📌 Résultat :{' '}
                        {stats.wins}{' '}
                        gains /{' '}
                        {stats.losses}{' '}
                        pertes
                    </div>

                    <div>
                        📈 Taux final :{' '}
                        {winRate.toFixed(
                            2
                        )}
                        %
                    </div>

                    <div>
                        💰 Résultat virtuel :{' '}
                        {stats.virtualProfit >=
                        0
                            ? '+'
                            : ''}
                        $
                        {stats.virtualProfit.toFixed(
                            2
                        )}
                    </div>
                </>
            ) : (
                <>
                    <div>
                        🔬 Paper Trading en
                        cours.
                    </div>

                    <div>
                        ⚠️ Résultat
                        expérimental. Aucun
                        taux de réussite
                        n'est garanti.
                    </div>
                </>
            )}

            <div
                style={{
                    marginTop:
                        '12px',
                    padding:
                        '10px',
                    background:
                        '#222222',
                    borderRadius:
                        '8px',
                }}
            >
                🛡️ <strong>
                    MODE PAPIER UNIQUEMENT
                </strong>
                <br />
                ❌ Aucun contrat réel n'est
                envoyé.
                <br />
                💵 Le gain/perte affiché est
                virtuel.
            </div>
        </div>
    );
}

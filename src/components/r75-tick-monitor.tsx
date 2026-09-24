import React, { useEffect, useRef, useState } from 'react';
import { api_base } from '../external/bot-skeleton';

const MARKET_SYMBOL = 'frxEURUSD';
const MARKET_NAME = 'EUR/USD';

const HISTORY_SIZE = 500;
const PAPER_TEST_LIMIT = 1000;
const BLOCK_SIZE = 100;

type Direction = 'UP' | 'DOWN' | 'FLAT';

type Tick = {
    symbol?: string;
    quote?: number;
    epoch?: number;
};

type Stats = {
    tests: number;
    wins: number;
    losses: number;
    skipped: number;
    virtualProfit: number;
};

type MatrixType = {
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

const createMatrix = (): MatrixType => ({
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

const directionLabel = (direction: Direction | null) => {
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

const cloneMatrix = (matrix: MatrixType): MatrixType => ({
    UP: { ...matrix.UP },
    DOWN: { ...matrix.DOWN },
    FLAT: { ...matrix.FLAT },
});

export default function R75TickMonitor() {
    const [connected, setConnected] = useState(false);
    const [connectionError, setConnectionError] = useState('');

    const [price, setPrice] = useState<number | null>(null);

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

    const [observations, setObservations] = useState(0);

    const [stats, setStats] = useState<Stats>({
        tests: 0,
        wins: 0,
        losses: 0,
        skipped: 0,
        virtualProfit: 0,
    });

    const [matrix, setMatrix] =
        useState<MatrixType>(createMatrix());

    const [blocks, setBlocks] = useState<number[]>([]);

    const [currentBlockWins, setCurrentBlockWins] =
        useState(0);

    const [currentBlockTests, setCurrentBlockTests] =
        useState(0);

    /*
     * =========================================================
     * REFS
     * =========================================================
     */

    const previousPriceRef =
        useRef<number | null>(null);

    const historyRef =
        useRef<Direction[]>([]);

    const matrixRef =
        useRef<MatrixType>(createMatrix());

    /*
     * Prédiction réalisée sur le tick précédent.
     *
     * Exemple :
     * tick A -> prédiction HAUSSE
     * tick B -> on vérifie si B est effectivement HAUSSE
     */
    const predictionRef =
        useRef<Direction | null>(null);

    const testsRef = useRef(0);
    const winsRef = useRef(0);
    const lossesRef = useRef(0);
    const skippedRef = useRef(0);

    const virtualProfitRef = useRef(0);

    const blockWinsRef = useRef(0);
    const blockTestsRef = useRef(0);

    /*
     * Empêche plusieurs abonnements.
     */
    const subscribedRef = useRef(false);

    /*
     * =========================================================
     * CALCUL DE LA PRÉDICTION
     * =========================================================
     */

    const calculatePrediction = (
        current: Direction
    ) => {
        const row = matrixRef.current[current];

        const up = row.UP;
        const down = row.DOWN;

        const tradableTotal = up + down;

        /*
         * On ne prend pas STABLE comme signal de trading.
         */
        if (tradableTotal === 0) {
            return {
                direction: null as Direction | null,
                strength: 0,
            };
        }

        if (up >= down) {
            return {
                direction: 'UP' as Direction,
                strength:
                    (up / tradableTotal) * 100,
            };
        }

        return {
            direction: 'DOWN' as Direction,
            strength:
                (down / tradableTotal) * 100,
        };
    };

    /*
     * =========================================================
     * TRAITEMENT D'UN TICK
     * =========================================================
     */

    const processTick = (
        tick: Tick
    ) => {
        if (tick.symbol !== MARKET_SYMBOL) {
            return;
        }

        if (
            typeof tick.quote !== 'number' ||
            !Number.isFinite(tick.quote)
        ) {
            return;
        }

        const currentPrice = tick.quote;

        setConnected(true);
        setConnectionError('');
        setPrice(currentPrice);

        /*
         * Premier tick.
         */
        if (previousPriceRef.current === null) {
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
         * =====================================================
         * PHASE 1 : APPRENTISSAGE
         * =====================================================
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
             * Construire la transition.
             *
             * Exemple :
             * UP -> DOWN
             */
            if (history.length >= 2) {
                const previousDirection =
                    history[history.length - 2];

                const currentDirection =
                    history[history.length - 1];

                matrixRef.current[
                    previousDirection
                ][currentDirection] += 1;
            }

            setHistoryCount(history.length);

            setMatrix(
                cloneMatrix(matrixRef.current)
            );

            /*
             * Les 500 ticks sont terminés.
             */
            if (
                history.length ===
                HISTORY_SIZE
            ) {
                setPhase('testing');

                /*
                 * Première prédiction à partir
                 * de la dernière direction connue.
                 */
                const result =
                    calculatePrediction(
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
            }

            return;
        }

        /*
         * =====================================================
         * PHASE 2 : PAPER TRADING
         * =====================================================
         */

        /*
         * Vérifier la prédiction précédente.
         */
        const previousPrediction =
            predictionRef.current;

        if (
            previousPrediction !== null &&
            testsRef.current <
                PAPER_TEST_LIMIT
        ) {
            /*
             * Seulement UP/DOWN sont tradables.
             */
            if (
                previousPrediction === 'UP' ||
                previousPrediction === 'DOWN'
            ) {
                testsRef.current += 1;

                blockTestsRef.current += 1;

                if (
                    previousPrediction ===
                    direction
                ) {
                    winsRef.current += 1;

                    blockWinsRef.current += 1;

                    virtualProfitRef.current +=
                        1;
                } else {
                    lossesRef.current += 1;

                    virtualProfitRef.current -=
                        1;
                }

                /*
                 * Fin d'un bloc de 100.
                 */
                if (
                    blockTestsRef.current ===
                    BLOCK_SIZE
                ) {
                    const blockRate =
                        (blockWinsRef.current /
                            BLOCK_SIZE) *
                        100;

                    setBlocks(
                        previous => [
                            ...previous,
                            blockRate,
                        ]
                    );

                    blockTestsRef.current = 0;
                    blockWinsRef.current = 0;
                }
            } else {
                skippedRef.current += 1;
            }

            /*
             * Mise à jour de l'affichage.
             */
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
        }

        /*
         * Si 1000 tests sont terminés,
         * on ne crée plus de nouveaux tests.
         */
        if (
            testsRef.current >=
            PAPER_TEST_LIMIT
        ) {
            setPhase('done');

            predictionRef.current = null;

            setPrediction(null);
            setPredictionStrength(0);

            return;
        }

        /*
         * =====================================================
         * MISE À JOUR DE LA MATRICE
         * =====================================================
         */

        const history =
            historyRef.current;

        const lastDirection =
            history[history.length - 1];

        if (lastDirection) {
            matrixRef.current[
                lastDirection
            ][direction] += 1;
        }

        /*
         * Historique roulant de 500 directions.
         */
        history.push(direction);

        if (
            history.length >
            HISTORY_SIZE
        ) {
            history.shift();
        }

        setHistoryCount(history.length);

        setMatrix(
            cloneMatrix(matrixRef.current)
        );

        /*
         * =====================================================
         * NOUVELLE PRÉDICTION
         * =====================================================
         */

        const result =
            calculatePrediction(
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

        /*
         * Nombre total d'observations.
         */
        const row =
            matrixRef.current[
                direction
            ];

        setObservations(
            row.UP +
                row.DOWN +
                row.FLAT
        );
    };

    /*
     * =========================================================
     * CONNEXION DERIV
     * =========================================================
     */

    useEffect(() => {
        let mounted = true;

        /*
         * Vérification API.
         */
        if (!api_base?.api) {
            setConnectionError(
                'api_base.api est indisponible.'
            );

            return () => {
                mounted = false;
            };
        }

        /*
         * Éviter un double abonnement.
         */
        if (subscribedRef.current) {
            return () => {
                mounted = false;
            };
        }

        subscribedRef.current = true;

        /*
         * IMPORTANT :
         *
         * Dans ton projet Deriv, onMessage()
         * retourne un observable.
         *
         * On utilise donc :
         *
         * api_base.api.onMessage().subscribe(...)
         */
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
                             * Message tick.
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
                             * Erreur API.
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

                                setConnectionError(
                                    String(
                                        message
                                    )
                                );
                            }
                        }
                    );

            /*
             * Demande du flux EUR/USD.
             */
            api_base.api.send({
                ticks: MARKET_SYMBOL,
                subscribe: 1,
            });

            setConnectionError('');
        } catch (error: any) {
            setConnectionError(
                error?.message ||
                    'Impossible de démarrer le flux Deriv.'
            );

            setConnected(false);
        }

        /*
         * Nettoyage.
         */
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

            subscribedRef.current = false;
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

    const displayPrice =
        price !== null
            ? price.toFixed(5)
            : '—';

    const currentRow =
        matrix[currentDirection];

    const currentRowTotal =
        currentRow.UP +
        currentRow.DOWN +
        currentRow.FLAT;

    /*
     * =========================================================
     * INTERFACE
     * =========================================================
     */

    return (
        <div
            style={{
                background:
                    '#111111',
                color: '#ffffff',
                padding: '20px',
                margin: '16px',
                borderRadius: '14px',
                fontFamily:
                    'Arial, sans-serif',
                lineHeight: 1.5,
            }}
        >
            <h2
                style={{
                    marginTop: 0,
                }}
            >
                Moniteur Forex EUR/USD —
                V4.6 Paper Trader
            </h2>

            {/* CONNEXION */}

            <div
                style={{
                    padding: '14px',
                    borderRadius: '12px',
                    background:
                        connected
                            ? '#064d29'
                            : '#3d3000',
                    marginBottom: '16px',
                }}
            >
                <strong>
                    Connexion :
                </strong>{' '}

                {connected ? (
                    <>
                        🟢 Connecté à
                        Deriv —
                        EUR/USD
                    </>
                ) : (
                    <>
                        🟠 Connexion à
                        Deriv…
                    </>
                )}
            </div>

            {connectionError && (
                <div
                    style={{
                        background:
                            '#4b1111',
                        color:
                            '#ffb3b3',
                        padding:
                            '10px',
                        borderRadius:
                            '8px',
                        marginBottom:
                            '14px',
                    }}
                >
                    ⚠️{' '}
                    <strong>
                        Erreur :
                    </strong>{' '}
                    {connectionError}
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

            {/* PHASE 1 */}

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

            {historyCount <
            HISTORY_SIZE ? (
                <div>
                    ⏳ Collecte des
                    ticks en direct…
                </div>
            ) : (
                <div>
                    ✅ 500 ticks
                    collectés.
                </div>
            )}

            <h3>
                Analyse des
                transitions
            </h3>

            <div>
                <strong>
                    Direction
                    actuelle :
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
                    Observations :
                </strong>{' '}
                {currentRowTotal}
            </div>

            {/* MATRICE */}

            <h3>
                Matrice de
                transitions
            </h3>

            <div
                style={{
                    fontSize:
                        '13px',
                    marginBottom:
                        '8px',
                }}
            >
                Ligne =
                direction
                actuelle →
                colonne =
                direction
                suivante.
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
                        borderCollapse:
                            'collapse',
                        minWidth:
                            '500px',
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
                                {
                                    matrix
                                        .UP
                                        .UP
                                }
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
                                {
                                    matrix
                                        .UP
                                        .DOWN
                                }
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
                                {
                                    matrix
                                        .UP
                                        .FLAT
                                }
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
                                {
                                    matrix
                                        .DOWN
                                        .UP
                                }
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
                                {
                                    matrix
                                        .DOWN
                                        .DOWN
                                }
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
                                {
                                    matrix
                                        .DOWN
                                        .FLAT
                                }
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
                                {
                                    matrix
                                        .FLAT
                                        .UP
                                }
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
                                {
                                    matrix
                                        .FLAT
                                        .DOWN
                                }
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
                                {
                                    matrix
                                        .FLAT
                                        .FLAT
                                }
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <hr />

            {/* PAPER TRADING */}

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
                {winRate.toFixed(2)}
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

            <div
                style={{
                    marginTop:
                        '14px',
                    padding:
                        '14px',
                    background:
                        '#222222',
                    borderRadius:
                        '10px',
                }}
            >
                💰{' '}
                <strong>
                    Mise virtuelle :
                </strong>{' '}
                $1.00
                <br />

                🟢{' '}
                <strong>
                    Gain virtuel :
                </strong>{' '}
                +1
                <br />

                🔴{' '}
                <strong>
                    Perte virtuelle :
                </strong>{' '}
                -1
                <br />

                🚫 Aucun argent
                réel n'est engagé.
            </div>

            <div
                style={{
                    marginTop:
                        '16px',
                    padding:
                        '18px',
                    borderRadius:
                        '12px',
                    background:
                        stats.virtualProfit >=
                        0
                            ? '#063f22'
                            : '#4a1010',
                }}
            >
                <div
                    style={{
                        fontSize:
                            '24px',
                        fontWeight:
                            'bold',
                    }}
                >
                    {stats.virtualProfit >=
                    0
                        ? '🟢'
                        : '🔴'}{' '}
                    Résultat
                    virtuel :{' '}
                    {stats.virtualProfit >=
                    0
                        ? '+'
                        : ''}
                    {stats.virtualProfit}
                </div>

                <div>
                    Solde virtuel :{' '}
                    {stats.virtualProfit >=
                    0
                        ? '+'
                        : ''}
                    {
                        stats.virtualProfit
                    }{' '}
                    $
                </div>
            </div>

            <hr />

            {/* BLOCS */}

            <h3>
                📊 Blocs de{' '}
                {BLOCK_SIZE}
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
                        <strong>
                            {rate.toFixed(
                                1
                            )}
                            %
                        </strong>
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

            {/* ÉTAT FINAL */}

            {phase ===
            'done' ? (
                <div
                    style={{
                        padding:
                            '14px',
                        background:
                            '#123d24',
                        borderRadius:
                            '10px',
                    }}
                >
                    ✅{' '}
                    <strong>
                        Paper test
                        terminé.
                    </strong>

                    <br />

                    Résultat :
                    {stats.wins}{' '}
                    gains /
                    {stats.losses}{' '}
                    pertes.

                    <br />

                    Taux final :{' '}
                    {winRate.toFixed(
                        2
                    )}
                    %

                    <br />

                    Résultat
                    virtuel :{' '}
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
                    🔬 Le système
                    fonctionne en
                    mode
                    apprentissage /
                    paper trading.
                </div>
            )}

            <div
                style={{
                    marginTop:
                        '12px',
                    color:
                        '#ffcc66',
                }}
            >
                ⚠️ Résultat
                expérimental :
                aucun taux de
                réussite n'est
                garanti.
            </div>

            <div
                style={{
                    marginTop:
                        '8px',
                    color:
                        '#ff7777',
                }}
            >
                ❌ Aucun trade
                automatique réel.
            </div>
        </div>
    );
}

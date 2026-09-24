import React, { useEffect, useRef, useState } from 'react';
import TicksService from '../external/bot-skeleton/services/api/ticks_service';

const MARKET_SYMBOL = 'frxEURUSD';
const MARKET_NAME = 'EUR/USD';

const HISTORY_SIZE = 500;
const PAPER_TEST_LIMIT = 1000;
const BLOCK_SIZE = 100;

type Direction = 'UP' | 'DOWN' | 'FLAT';

type Matrix = {
    UP: Record<Direction, number>;
    DOWN: Record<Direction, number>;
    FLAT: Record<Direction, number>;
};

const createMatrix = (): Matrix => ({
    UP: { UP: 0, DOWN: 0, FLAT: 0 },
    DOWN: { UP: 0, DOWN: 0, FLAT: 0 },
    FLAT: { UP: 0, DOWN: 0, FLAT: 0 },
});

const getDirection = (previous: number, current: number): Direction => {
    if (current > previous) return 'UP';
    if (current < previous) return 'DOWN';
    return 'FLAT';
};

const getPrediction = (matrix: Matrix, direction: Direction): Direction => {
    const row = matrix[direction];

    const values = [
        { direction: 'UP' as Direction, value: row.UP },
        { direction: 'DOWN' as Direction, value: row.DOWN },
        { direction: 'FLAT' as Direction, value: row.FLAT },
    ];

    values.sort((a, b) => b.value - a.value);

    return values[0].direction;
};

const getTotal = (matrix: Matrix, direction: Direction) =>
    matrix[direction].UP +
    matrix[direction].DOWN +
    matrix[direction].FLAT;

const getFrequency = (matrix: Matrix, direction: Direction, target: Direction) => {
    const total = getTotal(matrix, direction);

    if (!total) return 0;

    return (matrix[direction][target] / total) * 100;
};

export default function R75TickMonitor() {
    const [connected, setConnected] = useState(false);
    const [price, setPrice] = useState<number | null>(null);
    const [historyCount, setHistoryCount] = useState(0);

    const [currentDirection, setCurrentDirection] =
        useState<Direction>('FLAT');

    const [prediction, setPrediction] =
        useState<Direction>('FLAT');

    const [predictionFrequency, setPredictionFrequency] = useState(0);

    const [tests, setTests] = useState(0);
    const [successes, setSuccesses] = useState(0);
    const [failures, setFailures] = useState(0);

    const [blocks, setBlocks] = useState<number[]>([]);
    const [currentBlockSuccess, setCurrentBlockSuccess] = useState(0);
    const [currentBlockTests, setCurrentBlockTests] = useState(0);

    const [matrix, setMatrix] = useState<Matrix>(createMatrix());

    const [error, setError] = useState('');

    const serviceRef = useRef<TicksService | null>(null);
    const monitorKeyRef = useRef<string | null>(null);

    const initializedRef = useRef(false);
    const lastEpochRef = useRef<number | null>(null);

    const previousDirectionRef = useRef<Direction>('FLAT');
    const predictionRef = useRef<Direction>('FLAT');

    const testsRef = useRef(0);
    const successesRef = useRef(0);

    const blockSuccessRef = useRef(0);
    const blockTestsRef = useRef(0);

    const matrixRef = useRef<Matrix>(createMatrix());

    useEffect(() => {
        let active = true;

        const start = async () => {
            try {
                setError('');
                setConnected(false);

                /*
                 * L'application peut avoir besoin de quelques instants
                 * pour initialiser api_base.
                 */
                let attempts = 0;

                while (active && attempts < 40) {
                    const { api_base } = await import(
                        '../external/bot-skeleton/services/api/api-base'
                    );

                    if (api_base?.api) {
                        break;
                    }

                    attempts += 1;

                    await new Promise(resolve =>
                        setTimeout(resolve, 250)
                    );
                }

                if (!active) return;

                const { api_base } = await import(
                    '../external/bot-skeleton/services/api/api-base'
                );

                if (!api_base?.api) {
                    setError('API Deriv non prête après attente.');
                    return;
                }

                const service = new TicksService();

                serviceRef.current = service;

                const key = await service.monitor({
                    symbol: MARKET_SYMBOL,
                    callback: (ticks: Array<{ epoch: number; quote: number }>) => {
                        if (!active || !ticks?.length) return;

                        const validTicks = ticks.filter(
                            tick =>
                                Number.isFinite(tick?.quote) &&
                                Number.isFinite(tick?.epoch)
                        );

                        if (!validTicks.length) return;

                        const lastTick = validTicks[validTicks.length - 1];

                        setConnected(true);
                        setPrice(lastTick.quote);

                        /*
                         * =========================
                         * PHASE 1 : APPRENTISSAGE
                         * =========================
                         */
                        if (!initializedRef.current) {
                            if (validTicks.length < HISTORY_SIZE) {
                                setHistoryCount(validTicks.length);
                                return;
                            }

                            const history = validTicks.slice(-HISTORY_SIZE);

                            const initialMatrix = createMatrix();

                            let previousDirection: Direction = 'FLAT';

                            for (let i = 1; i < history.length; i += 1) {
                                const direction = getDirection(
                                    history[i - 1].quote,
                                    history[i].quote
                                );

                                if (i > 1) {
                                    initialMatrix[previousDirection][direction] += 1;
                                }

                                previousDirection = direction;
                            }

                            matrixRef.current = initialMatrix;
                            setMatrix(initialMatrix);

                            const lastDirection = getDirection(
                                history[history.length - 2].quote,
                                history[history.length - 1].quote
                            );

                            previousDirectionRef.current = lastDirection;
                            setCurrentDirection(lastDirection);

                            const nextPrediction = getPrediction(
                                initialMatrix,
                                lastDirection
                            );

                            predictionRef.current = nextPrediction;
                            setPrediction(nextPrediction);

                            setPredictionFrequency(
                                getFrequency(
                                    initialMatrix,
                                    lastDirection,
                                    nextPrediction
                                )
                            );

                            lastEpochRef.current = lastTick.epoch;
                            initializedRef.current = true;

                            setHistoryCount(HISTORY_SIZE);

                            return;
                        }

                        /*
                         * Évite de traiter deux fois le même tick.
                         */
                        if (lastEpochRef.current === lastTick.epoch) {
                            return;
                        }

                        lastEpochRef.current = lastTick.epoch;

                        if (testsRef.current >= PAPER_TEST_LIMIT) {
                            return;
                        }

                        const previousTick =
                            validTicks.length >= 2
                                ? validTicks[validTicks.length - 2]
                                : null;

                        if (!previousTick) return;

                        const actualDirection = getDirection(
                            previousTick.quote,
                            lastTick.quote
                        );

                        const oldPrediction = predictionRef.current;
                        const oldDirection = previousDirectionRef.current;

                        /*
                         * =========================
                         * TEST PAPER
                         * =========================
                         */
                        const testNumber = testsRef.current + 1;

                        let newSuccesses = successesRef.current;

                        if (oldPrediction !== 'FLAT') {
                            if (oldPrediction === actualDirection) {
                                newSuccesses += 1;
                                successesRef.current = newSuccesses;
                                setSuccesses(newSuccesses);

                                blockSuccessRef.current += 1;
                                setCurrentBlockSuccess(
                                    blockSuccessRef.current
                                );
                            } else {
                                setFailures(
                                    testNumber - newSuccesses
                                );
                            }

                            blockTestsRef.current += 1;
                            setCurrentBlockTests(
                                blockTestsRef.current
                            );
                        }

                        testsRef.current = testNumber;
                        setTests(testNumber);

                        /*
                         * =========================
                         * MATRICE DE TRANSITION
                         * =========================
                         */
                        const updatedMatrix = {
                            UP: { ...matrixRef.current.UP },
                            DOWN: { ...matrixRef.current.DOWN },
                            FLAT: { ...matrixRef.current.FLAT },
                        };

                        updatedMatrix[oldDirection][actualDirection] += 1;

                        matrixRef.current = updatedMatrix;
                        setMatrix(updatedMatrix);

                        /*
                         * Nouveau signal pour le prochain tick.
                         */
                        const nextPrediction = getPrediction(
                            updatedMatrix,
                            actualDirection
                        );

                        predictionRef.current = nextPrediction;
                        previousDirectionRef.current = actualDirection;

                        setCurrentDirection(actualDirection);
                        setPrediction(nextPrediction);

                        setPredictionFrequency(
                            getFrequency(
                                updatedMatrix,
                                actualDirection,
                                nextPrediction
                            )
                        );

                        /*
                         * =========================
                         * BLOC DE 100
                         * =========================
                         */
                        if (blockTestsRef.current >= BLOCK_SIZE) {
                            setBlocks(prev => [
                                ...prev,
                                blockSuccessRef.current,
                            ]);

                            blockSuccessRef.current = 0;
                            blockTestsRef.current = 0;

                            setCurrentBlockSuccess(0);
                            setCurrentBlockTests(0);
                        }
                    },
                });

                monitorKeyRef.current = key;
                setConnected(true);
            } catch (e) {
                console.error('V4.3 connection error:', e);

                if (active) {
                    setConnected(false);
                    setError('Erreur de connexion au flux EUR/USD.');
                }
            }
        };

        start();

        return () => {
            active = false;

            const service = serviceRef.current;
            const key = monitorKeyRef.current;

            if (service && key) {
                service
                    .stopMonitor({
                        symbol: MARKET_SYMBOL,
                        key,
                    })
                    .catch(() => {});
            }

            serviceRef.current = null;
            monitorKeyRef.current = null;
        };
    }, []);

    const successRate =
        tests > 0 ? (successes / tests) * 100 : 0;

    const completedBlocks = blocks.length;

    const averageBlock =
        blocks.length > 0
            ? blocks.reduce((sum, value) => sum + value, 0) /
              blocks.length
            : 0;

    const minBlock =
        blocks.length > 0 ? Math.min(...blocks) : 0;

    const maxBlock =
        blocks.length > 0 ? Math.max(...blocks) : 0;

    return (
        <div
            style={{
                margin: '16px',
                padding: '20px',
                borderRadius: '12px',
                background: '#111',
                color: '#fff',
                fontFamily: 'Arial, sans-serif',
            }}
        >
            <h2 style={{ marginTop: 0 }}>
                Moniteur Forex EUR/USD — V4.3 Paper Trader
            </h2>

            <div
                style={{
                    padding: '10px',
                    borderRadius: '8px',
                    background: connected ? '#123d22' : '#3d3212',
                    marginBottom: '15px',
                }}
            >
                {connected
                    ? '🟢 Connecté à Deriv — EUR/USD'
                    : '🟠 Connexion à Deriv…'}
            </div>

            {error && (
                <div
                    style={{
                        padding: '10px',
                        marginBottom: '15px',
                        borderRadius: '8px',
                        background: '#4a1616',
                    }}
                >
                    ❌ {error}
                </div>
            )}

            <div style={{ marginBottom: '15px' }}>
                <strong>Prix :</strong>{' '}
                {price !== null ? price.toFixed(5) : '—'}
            </div>

            <div style={{ marginBottom: '15px' }}>
                <strong>Historique :</strong>{' '}
                {historyCount} / {HISTORY_SIZE}
            </div>

            <hr />

            <h3>Analyse</h3>

            <div>
                <strong>Direction actuelle :</strong>{' '}
                {currentDirection}
            </div>

            <div>
                <strong>Prédiction :</strong>{' '}
                {prediction}
            </div>

            <div>
                <strong>Fréquence historique :</strong>{' '}
                {predictionFrequency.toFixed(1)}%
            </div>

            <hr />

            <h3>Matrice de transition</h3>

            <table
                style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    textAlign: 'center',
                }}
            >
                <thead>
                    <tr>
                        <th>De / Vers</th>
                        <th>UP</th>
                        <th>DOWN</th>
                        <th>FLAT</th>
                    </tr>
                </thead>

                <tbody>
                    <tr>
                        <td>UP</td>
                        <td>{matrix.UP.UP}</td>
                        <td>{matrix.UP.DOWN}</td>
                        <td>{matrix.UP.FLAT}</td>
                    </tr>

                    <tr>
                        <td>DOWN</td>
                        <td>{matrix.DOWN.UP}</td>
                        <td>{matrix.DOWN.DOWN}</td>
                        <td>{matrix.DOWN.FLAT}</td>
                    </tr>

                    <tr>
                        <td>FLAT</td>
                        <td>{matrix.FLAT.UP}</td>
                        <td>{matrix.FLAT.DOWN}</td>
                        <td>{matrix.FLAT.FLAT}</td>
                    </tr>
                </tbody>
            </table>

            <hr />

            <h3>Paper Test</h3>

            <div>
                Tests réalisés : {tests} / {PAPER_TEST_LIMIT}
            </div>

            <div>
                🟢 Succès : {successes}
            </div>

            <div>
                🔴 Échecs : {failures}
            </div>

            <div>
                📊 Taux : {successRate.toFixed(2)}%
            </div>

            <div>
                Bloc actuel : {currentBlockSuccess} / {currentBlockTests}
            </div>

            <hr />

            <h3>Blocs de {BLOCK_SIZE}</h3>

            <div>
                Blocs terminés : {completedBlocks}
            </div>

            <div>
                Moyenne : {averageBlock.toFixed(2)}
            </div>

            <div>
                Minimum : {minBlock}
            </div>

            <div>
                Maximum : {maxBlock}
            </div>

            <div
                style={{
                    marginTop: '10px',
                    fontSize: '13px',
                    opacity: 0.75,
                }}
            >
                ⚪ Analyse et paper trading uniquement.
                Aucun trade réel n'est envoyé.
            </div>
        </div>
    );
}

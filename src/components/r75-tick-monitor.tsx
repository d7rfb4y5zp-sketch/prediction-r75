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

const directionLabel = (direction: Direction) => {
    if (direction === 'UP') return '🟢 HAUSSE';
    if (direction === 'DOWN') return '🔴 BAISSE';
    return '⚪ STABLE';
};

const getDirection = (previous: number, current: number): Direction => {
    if (current > previous) return 'UP';
    if (current < previous) return 'DOWN';
    return 'FLAT';
};

const emptyMatrix = () => ({
    UP: { UP: 0, DOWN: 0, FLAT: 0 },
    DOWN: { UP: 0, DOWN: 0, FLAT: 0 },
    FLAT: { UP: 0, DOWN: 0, FLAT: 0 },
});

export default function R75TickMonitor() {
    const [connected, setConnected] = useState(false);
    const [price, setPrice] = useState<number | null>(null);

    const [historyCount, setHistoryCount] = useState(0);
    const [phase, setPhase] = useState<'learning' | 'testing' | 'done'>(
        'learning'
    );

    const [currentDirection, setCurrentDirection] =
        useState<Direction>('FLAT');

    const [prediction, setPrediction] =
        useState<Direction | null>(null);

    const [predictionStrength, setPredictionStrength] = useState(0);

    const [stats, setStats] = useState<Stats>({
        tests: 0,
        wins: 0,
        losses: 0,
        skipped: 0,
        virtualProfit: 0,
    });

    const [blocks, setBlocks] = useState<number[]>([]);
    const [currentBlockWins, setCurrentBlockWins] = useState(0);

    const [matrix, setMatrix] = useState(emptyMatrix());

    /*
     * Prix précédents.
     */
    const previousPriceRef = useRef<number | null>(null);

    /*
     * Historique utilisé pour construire le modèle.
     */
    const historyRef = useRef<Direction[]>([]);

    /*
     * Matrice de transitions.
     *
     * Ligne = direction actuelle
     * Colonne = direction suivante
     */
    const matrixRef = useRef(emptyMatrix());

    /*
     * Prédiction faite sur le tick précédent.
     * Elle sera vérifiée lorsque le tick suivant arrive.
     */
    const predictionRef = useRef<Direction | null>(null);

    /*
     * Nombre de tests.
     */
    const testsRef = useRef(0);
    const winsRef = useRef(0);
    const lossesRef = useRef(0);
    const skippedRef = useRef(0);

    /*
     * Bloc actuel.
     */
    const blockWinsRef = useRef(0);
    const blockTestsRef = useRef(0);

    /*
     * Résultat virtuel.
     *
     * +1 = gain virtuel
     * -1 = perte virtuelle
     *  0 = pas de trade
     */
    const virtualProfitRef = useRef(0);

    /*
     * Fonction qui choisit la direction suivante
     * la plus fréquente.
     */
    const calculatePrediction = (
        current: Direction
    ): {
        direction: Direction;
        strength: number;
    } => {
        const row = matrixRef.current[current];

        const up = row.UP;
        const down = row.DOWN;
        const flat = row.FLAT;

        const total = up + down + flat;

        if (total === 0) {
            return {
                direction: 'FLAT',
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
            strength: (highest / total) * 100,
        };
    };

    useEffect(() => {
        let active = true;

        const handleMessage = (message: any) => {
            if (!active) return;

            const tick: Tick = message?.tick;

            if (!tick) return;

            if (tick.symbol !== MARKET_SYMBOL) return;

            if (typeof tick.quote !== 'number') return;

            const currentPrice = tick.quote;

            setConnected(true);
            setPrice(currentPrice);

            /*
             * Premier tick.
             */
            if (previousPriceRef.current === null) {
                previousPriceRef.current = currentPrice;
                return;
            }

            const previousPrice = previousPriceRef.current;

            const direction = getDirection(
                previousPrice,
                currentPrice
            );

            previousPriceRef.current = currentPrice;

            setCurrentDirection(direction);

            /*
             * =====================================================
             * PHASE 1 — APPRENTISSAGE
             * =====================================================
             */
            if (historyRef.current.length < HISTORY_SIZE) {
                historyRef.current.push(direction);

                setHistoryCount(historyRef.current.length);

                /*
                 * Construire progressivement la matrice.
                 */
                if (historyRef.current.length >= 2) {
                    const history = historyRef.current;

                    const previousDirection =
                        history[history.length - 2];

                    const currentDirection =
                        history[history.length - 1];

                    matrixRef.current[
                        previousDirection
                    ][currentDirection] += 1;

                    setMatrix({
                        ...matrixRef.current,
                    });
                }

                if (historyRef.current.length === HISTORY_SIZE) {
                    setPhase('testing');
                }

                return;
            }

            /*
             * =====================================================
             * PHASE 2 — VALIDATION / PAPER TRADING
             * =====================================================
             */

            /*
             * 1. Vérifier la prédiction faite au tick précédent.
             */
            if (
                predictionRef.current !== null &&
                testsRef.current < PAPER_TEST_LIMIT
            ) {
                const previousPrediction =
                    predictionRef.current;

                /*
                 * STABLE n'est pas considéré comme un trade.
                 */
                if (previousPrediction === 'FLAT') {
                    skippedRef.current += 1;
                } else {
                    testsRef.current += 1;
                    blockTestsRef.current += 1;

                    if (previousPrediction === direction) {
                        winsRef.current += 1;
                        blockWinsRef.current += 1;

                        /*
                         * Gain virtuel.
                         */
                        virtualProfitRef.current += 1;
                    } else {
                        lossesRef.current += 1;

                        /*
                         * Perte virtuelle.
                         */
                        virtualProfitRef.current -= 1;
                    }

                    /*
                     * Fin d'un bloc de 100 trades virtuels.
                     */
                    if (blockTestsRef.current === BLOCK_SIZE) {
                        const blockRate =
                            (blockWinsRef.current /
                                blockTestsRef.current) *
                            100;

                        setBlocks((previous) => [
                            ...previous,
                            blockRate,
                        ]);

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
                    skipped: skippedRef.current,
                    virtualProfit:
                        virtualProfitRef.current,
                });
            }

            /*
             * Si la validation est terminée,
             * on arrête de créer de nouveaux tests.
             */
            if (testsRef.current >= PAPER_TEST_LIMIT) {
                setPhase('done');
                return;
            }

            /*
             * =====================================================
             * MISE À JOUR DE LA MATRICE
             * =====================================================
             */

            const history = historyRef.current;

            const lastDirection =
                history[history.length - 1];

            if (lastDirection) {
                matrixRef.current[
                    lastDirection
                ][direction] += 1;
            }

            /*
             * Historique roulant.
             */
            historyRef.current.push(direction);

            if (historyRef.current.length > HISTORY_SIZE) {
                historyRef.current.shift();
            }

            setHistoryCount(historyRef.current.length);

            setMatrix({
                ...matrixRef.current,
            });

            /*
             * =====================================================
             * NOUVELLE PRÉDICTION
             * =====================================================
             */

            const nextPrediction =
                calculatePrediction(direction);

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
         * Écoute des ticks.
         */
        const unsubscribe =
            api_base.api.onMessage(handleMessage);

        /*
         * Abonnement EUR/USD.
         */
        api_base.api.send({
            ticks: MARKET_SYMBOL,
            subscribe: 1,
        });

        return () => {
            active = false;

            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        };
    }, []);

    const totalTests = stats.tests;

    const winRate =
        totalTests > 0
            ? (stats.wins / totalTests) * 100
            : 0;

    const lossRate =
        totalTests > 0
            ? (stats.losses / totalTests) * 100
            : 0;

    const currentBlockTests =
        stats.tests % BLOCK_SIZE;

    const averageBlock =
        blocks.length > 0
            ? blocks.reduce(
                  (sum, value) => sum + value,
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
                background: '#ffffff',
                color: '#111111',
                padding: '20px',
                margin: '16px',
                borderRadius: '12px',
                fontFamily: 'Arial, sans-serif',
                lineHeight: 1.45,
            }}
        >
            <h2
                style={{
                    marginTop: 0,
                    marginBottom: 8,
                }}
            >
                Moniteur Forex EUR/USD — V4 Paper Trader
            </h2>

            <div>
                <strong>Connexion :</strong>{' '}
                {connected ? (
                    <>
                        🟢 Connecté à Deriv — EUR/USD
                    </>
                ) : (
                    <>
                        🟠 Connexion à Deriv…
                    </>
                )}
            </div>

            <div>
                <strong>Marché :</strong> {MARKET_NAME}
            </div>

            <div>
                <strong>Symbole :</strong> {MARKET_SYMBOL}
            </div>

            <div>
                <strong>Prix :</strong> {displayPrice}
            </div>

            <hr />

            <h3 style={{ marginBottom: 6 }}>
                Phase 1 — Apprentissage
            </h3>

            <div>
                <strong>Historique :</strong>{' '}
                {historyCount} / {HISTORY_SIZE}
            </div>

            {historyCount >= HISTORY_SIZE ? (
                <div>✅ 500 ticks collectés.</div>
            ) : (
                <div>
                    ⏳ Collecte des ticks…
                </div>
            )}

            <hr />

            <h3 style={{ marginBottom: 6 }}>
                Analyse des transitions
            </h3>

            <div>
                <strong>Direction actuelle :</strong>{' '}
                {directionLabel(currentDirection)}
            </div>

            <div>
                <strong>Prédiction suivante :</strong>{' '}
                {prediction
                    ? directionLabel(prediction)
                    : '⏳ —'}
            </div>

            <div>
                <strong>Force du signal :</strong>{' '}
                {prediction
                    ? `${predictionStrength.toFixed(1)} %`
                    : '—'}
            </div>

            <div>
                <strong>Observations de la direction :</strong>{' '}
                {rowTotal}
            </div>

            <h3 style={{ marginBottom: 6 }}>
                Matrice de transitions
            </h3>

            <div style={{ fontSize: 13 }}>
                Ligne = direction actuelle → colonne =
                direction suivante.
            </div>

            <table
                style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    marginTop: 10,
                }}
            >
                <thead>
                    <tr>
                        <th style={{ border: '1px solid #ccc', padding: 8 }}>
                            →
                        </th>
                        <th style={{ border: '1px solid #ccc', padding: 8 }}>
                            HAUSSE
                        </th>
                        <th style={{ border: '1px solid #ccc', padding: 8 }}>
                            BAISSE
                        </th>
                        <th style={{ border: '1px solid #ccc', padding: 8 }}>
                            STABLE
                        </th>
                    </tr>
                </thead>

                <tbody>
                    <tr>
                        <td style={{ border: '1px solid #ccc', padding: 8 }}>
                            🟢 HAUSSE
                        </td>
                        <td style={{ border: '1px solid #ccc', padding: 8, textAlign: 'center' }}>
                            {matrix.UP.UP}
                        </td>
                        <td style={{ border: '1px solid #ccc', padding: 8, textAlign: 'center' }}>
                            {matrix.UP.DOWN}
                        </td>
                        <td style={{ border: '1px solid #ccc', padding: 8, textAlign: 'center' }}>
                            {matrix.UP.FLAT}
                        </td>
                    </tr>

                    <tr>
                        <td style={{ border: '1px solid #ccc', padding: 8 }}>
                            🔴 BAISSE
                        </td>
                        <td style={{ border: '1px solid #ccc', padding: 8, textAlign: 'center' }}>
                            {matrix.DOWN.UP}
                        </td>
                        <td style={{ border: '1px solid #ccc', padding: 8, textAlign: 'center' }}>
                            {matrix.DOWN.DOWN}
                        </td>
                        <td style={{ border: '1px solid #ccc', padding: 8, textAlign: 'center' }}>
                            {matrix.DOWN.FLAT}
                        </td>
                    </tr>

                    <tr>
                        <td style={{ border: '1px solid #ccc', padding: 8 }}>
                            ⚪ STABLE
                        </td>
                        <td style={{ border: '1px solid #ccc', padding: 8, textAlign: 'center' }}>
                            {matrix.FLAT.UP}
                        </td>
                        <td style={{ border: '1px solid #ccc', padding: 8, textAlign: 'center' }}>
                            {matrix.FLAT.DOWN}
                        </td>
                        <td style={{ border: '1px solid #ccc', padding: 8, textAlign: 'center' }}>
                            {matrix.FLAT.FLAT}
                        </td>
                    </tr>
                </tbody>
            </table>

            <hr />

            <h3 style={{ marginBottom: 6 }}>
                Phase 2 — Paper Trading
            </h3>

            <div>
                <strong>Tests :</strong>{' '}
                {stats.tests} / {PAPER_TEST_LIMIT}
            </div>

            <div>
                <strong>🟢 Trades gagnants :</strong>{' '}
                {stats.wins}
            </div>

            <div>
                <strong>🔴 Trades perdants :</strong>{' '}
                {stats.losses}
            </div>

            <div>
                <strong>⚪ Signaux ignorés :</strong>{' '}
                {stats.skipped}
            </div>

            <div>
                <strong>Taux de réussite :</strong>{' '}
                {winRate.toFixed(2)} %
            </div>

            <div>
                <strong>Taux d'échec :</strong>{' '}
                {lossRate.toFixed(2)} %
            </div>

            <div>
                <strong>Résultat virtuel :</strong>{' '}
                {stats.virtualProfit >= 0 ? '+' : ''}
                {stats.virtualProfit}
            </div>

            <div
                style={{
                    marginTop: 8,
                    padding: 10,
                    background: '#f3f3f3',
                    borderRadius: 8,
                }}
            >
                💰 <strong>1 gain virtuel = +1</strong>
                <br />
                💸 <strong>1 perte virtuelle = -1</strong>
                <br />
                🚫 Aucun argent réel n'est engagé.
            </div>

            <hr />

            <h3 style={{ marginBottom: 6 }}>
                📊 Blocs de {BLOCK_SIZE}
            </h3>

            <div>
                <strong>Blocs terminés :</strong>{' '}
                {blocks.length}
            </div>

            {blocks.map((rate, index) => (
                <div key={index}>
                    Bloc {index + 1} :{' '}
                    {rate.toFixed(1)} %
                </div>
            ))}

            {stats.tests < PAPER_TEST_LIMIT &&
                currentBlockTests > 0 && (
                    <div>
                        Bloc actuel :{' '}
                        {currentBlockWinsRefSafe(
                            currentBlockWins
                        )}{' '}
                        / {currentBlockTests}
                    </div>
                )}

            <div style={{ marginTop: 8 }}>
                <strong>Moyenne :</strong>{' '}
                {averageBlock.toFixed(2)} %
            </div>

            <div>
                <strong>Minimum :</strong>{' '}
                {minimumBlock.toFixed(2)} %
            </div>

            <div>
                <strong>Maximum :</strong>{' '}
                {maximumBlock.toFixed(2)} %
            </div>

            <hr />

            {phase === 'done' ? (
                <>
                    <div>
                        ✅ Paper test terminé.
                    </div>

                    <div>
                        📌 {stats.wins} gains /{' '}
                        {stats.losses} pertes.
                    </div>

                    <div>
                        📈 Taux final :{' '}
                        {winRate.toFixed(2)} %
                    </div>

                    <div>
                        💰 Résultat virtuel :{' '}
                        {stats.virtualProfit >= 0
                            ? '+'
                            : ''}
                        {stats.virtualProfit}
                    </div>
                </>
            ) : (
                <>
                    <div>
                        🔬 Le système reste en mode
                        analyse/paper trading.
                    </div>

                    <div>
                        ⚠️ Résultat expérimental.
                        Aucun taux de réussite n'est garanti.
                    </div>
                </>
            )}

            <div style={{ marginTop: 8 }}>
                ❌ <strong>Aucun trade automatique réel.</strong>
            </div>
        </div>
    );
}

/*
 * Petite fonction uniquement pour sécuriser
 * l'affichage du bloc courant.
 */
function currentBlockWinsRefSafe(
    value: number
) {
    return value;
}

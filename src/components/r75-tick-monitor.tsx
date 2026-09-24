import React, { useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';

const HISTORY_SIZE = 500;
const TEST_LIMIT = 3000;
const BLOCK_SIZE = 100;

const R75TickMonitor = () => {
    const [status, setStatus] = useState('🟠 Connexion à Deriv…');
    const [price, setPrice] = useState('—');
    const [digit, setDigit] = useState('—');

    const [history, setHistory] = useState<number[]>([]);
    const [tests, setTests] = useState(0);
    const [successes, setSuccesses] = useState(0);

    const [blockResults, setBlockResults] = useState<number[]>([]);
    const [currentBlockSuccess, setCurrentBlockSuccess] =
        useState(0);

    const historyRef = useRef<number[]>([]);
    const predictionRef = useRef<number | null>(null);

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

                setStatus('🟢 Connecté à Deriv');

                subscription = api_base.api
                    .onMessage()
                    .subscribe(({ data }: any) => {
                        if (data?.msg_type !== 'tick') {
                            return;
                        }

                        const tick = data.tick;

                        if (
                            !tick ||
                            tick.symbol !== 'R_75'
                        ) {
                            return;
                        }

                        const quote = Number(
                            tick.quote
                        );

                        if (!Number.isFinite(quote)) {
                            return;
                        }

                        const pipSize = Number(
                            tick.pip_size ?? 4
                        );

                        const formattedPrice =
                            quote.toFixed(pipSize);

                        const lastDigit = Number(
                            formattedPrice
                                .replace('.', '')
                                .slice(-1)
                        );

                        if (
                            !Number.isInteger(
                                lastDigit
                            ) ||
                            lastDigit < 0 ||
                            lastDigit > 9
                        ) {
                            return;
                        }

                        setPrice(formattedPrice);
                        setDigit(
                            String(lastDigit)
                        );

                        const oldHistory =
                            historyRef.current;

                        // =================================================
                        // PHASE 1 : APPRENTISSAGE
                        // =================================================

                        if (
                            oldHistory.length <
                            HISTORY_SIZE
                        ) {
                            const nextHistory = [
                                ...oldHistory,
                                lastDigit,
                            ];

                            historyRef.current =
                                nextHistory;

                            setHistory([
                                ...nextHistory,
                            ]);

                            predictionRef.current =
                                null;

                            return;
                        }

                        // =================================================
                        // PHASE 2 : TEST
                        // =================================================

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
                                lastDigit
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

                            // Fin d'un bloc de 100
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

                        // =================================================
                        // AJOUT DU TICK
                        // =================================================

                        const nextHistory = [
                            ...oldHistory,
                            lastDigit,
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

                        // =================================================
                        // SI LE TEST EST TERMINÉ
                        // =================================================

                        if (
                            testsRef.current >=
                            TEST_LIMIT
                        ) {
                            predictionRef.current =
                                null;

                            return;
                        }

                        // =================================================
                        // CONSTRUCTION DE LA MATRICE
                        // DES TRANSITIONS
                        // =================================================

                        const transitions =
                            Array.from(
                                { length: 10 },
                                () =>
                                    Array(10).fill(0)
                            );

                        for (
                            let i = 0;
                            i <
                            nextHistory.length - 1;
                            i++
                        ) {
                            const from =
                                nextHistory[i];

                            const to =
                                nextHistory[i + 1];

                            if (
                                from >= 0 &&
                                from <= 9 &&
                                to >= 0 &&
                                to <= 9
                            ) {
                                transitions[
                                    from
                                ][to]++;
                            }
                        }

                        // =================================================
                        // DERNIER CHIFFRE
                        // =================================================

                        const previousDigit =
                            lastDigit;

                        const row =
                            transitions[
                                previousDigit
                            ];

                        // =================================================
                        // CHOIX DU PROCHAIN CHIFFRE
                        // =================================================

                        let bestNextDigit = 0;
                        let highestCount =
                            row[0];

                        for (
                            let i = 1;
                            i < 10;
                            i++
                        ) {
                            if (
                                row[i] >
                                highestCount
                            ) {
                                highestCount =
                                    row[i];

                                bestNextDigit = i;
                            }
                        }

                        predictionRef.current =
                            bestNextDigit;
                    });

                api_base.api.send({
                    ticks: 'R_75',
                    subscribe: 1,
                });
            } catch (error) {
                console.error(
                    'R75 V3 error:',
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

    // =====================================================
    // MATRICE DES TRANSITIONS POUR AFFICHAGE
    // =====================================================

    const transitions =
        Array.from(
            { length: 10 },
            () => Array(10).fill(0)
        );

    for (
        let i = 0;
        i < history.length - 1;
        i++
    ) {
        const from = history[i];
        const to = history[i + 1];

        if (
            from >= 0 &&
            from <= 9 &&
            to >= 0 &&
            to <= 9
        ) {
            transitions[from][to]++;
        }
    }

    // =====================================================
    // DERNIÈRE LIGNE DE TRANSITION
    // =====================================================

    const currentDigit =
        history.length > 0
            ? history[history.length - 1]
            : null;

    const currentRow =
        currentDigit !== null
            ? transitions[currentDigit]
            : Array(10).fill(0);

    let displayedPrediction = 0;
    let displayedHighest =
        currentRow[0];

    for (let i = 1; i < 10; i++) {
        if (
            currentRow[i] >
            displayedHighest
        ) {
            displayedHighest =
                currentRow[i];

            displayedPrediction = i;
        }
    }

    const transitionTotal =
        currentRow.reduce(
            (sum, value) => sum + value,
            0
        );

    const predictionFrequency =
        transitionTotal > 0
            ? (
                  (displayedHighest /
                      transitionTotal) *
                  100
              ).toFixed(1)
            : '0.0';

    // =====================================================
    // STATISTIQUES
    // =====================================================

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
                      (sum, value) =>
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
                background: '#ffffff',
                color: '#000000',
                borderRadius: '10px',
            }}
        >
            <h2>
                Moniteur de ticks R75 — V3
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
                Volatility 75 (R_75)
            </p>

            <p>
                <strong>
                    Prix :
                </strong>{' '}
                {price}
            </p>

            <p>
                <strong>
                    Dernier chiffre :
                </strong>{' '}
                {digit}
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
                    📊 Construction de la
                    matrice des transitions...
                </p>
            ) : (
                <>
                    <p>
                        ✅ Base de 500 ticks
                        terminée.
                    </p>

                    <p>
                        🔒 Base d'analyse
                        verrouillée.
                    </p>

                    <hr />

                    <h3>
                        Transition actuelle
                    </h3>

                    <p>
                        <strong>
                            Dernier chiffre :
                        </strong>{' '}
                        {currentDigit}
                    </p>

                    <p>
                        <strong>
                            Observations après
                            ce chiffre :
                        </strong>{' '}
                        {transitionTotal}
                    </p>

                    <p>
                        <strong>
                            Transition la plus
                            fréquente :
                        </strong>{' '}
                        {displayedPrediction}
                    </p>

                    <p>
                        <strong>
                            Occurrences :
                        </strong>{' '}
                        {displayedHighest}
                    </p>

                    <p>
                        <strong>
                            Fréquence historique :
                        </strong>{' '}
                        {predictionFrequency}%
                    </p>

                    <hr />

                    <h3>
                        Matrice des transitions
                    </h3>

                    <p>
                        Ligne = chiffre actuel
                        → colonne = chiffre
                        suivant.
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
                                    '650px',
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

                                    {Array.from(
                                        {
                                            length: 10,
                                        },
                                        (
                                            _,
                                            index
                                        ) => (
                                            <th
                                                key={
                                                    index
                                                }
                                                style={{
                                                    border:
                                                        '1px solid #ccc',
                                                    padding:
                                                        '6px',
                                                }}
                                            >
                                                {
                                                    index
                                                }
                                            </th>
                                        )
                                    )}
                                </tr>
                            </thead>

                            <tbody>
                                {transitions.map(
                                    (
                                        row,
                                        from
                                    ) => (
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
                                                {
                                                    from
                                                }
                                            </th>

                                            {row.map(
                                                (
                                                    value,
                                                    to
                                                ) => (
                                                    <td
                                                        key={
                                                            to
                                                        }
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
                                                            value
                                                        }
                                                    </td>
                                                )
                                            )}
                                        </tr>
                                    )
                                )}
                            </tbody>
                        </table>
                    </div>

                    <hr />

                    <h3>
                        Phase 2 — Test V3
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
                        📌 Référence :
                        environ 10 %.
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
                                ✅ Test V3 de
                                3000 ticks
                                terminé.
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

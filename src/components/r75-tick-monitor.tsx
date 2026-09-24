import React, { useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';

const HISTORY_SIZE = 500;
const RECENT_SIZE = 100;
const TEST_LIMIT = 3000;

const R75TickMonitor = () => {
    const [status, setStatus] = useState('🟠 Connexion à Deriv…');
    const [price, setPrice] = useState('—');
    const [digit, setDigit] = useState('—');

    const [history, setHistory] = useState<number[]>([]);
    const [tests, setTests] = useState(0);
    const [successes, setSuccesses] = useState(0);

    // Refs : valeurs toujours à jour sans recréer
    // l'abonnement Deriv.
    const historyRef = useRef<number[]>([]);
    const predictionRef = useRef<number | null>(null);

    const testsRef = useRef(0);
    const successesRef = useRef(0);

    useEffect(() => {
        let subscription: any;

        const connect = () => {
            try {
                if (!api_base.api) {
                    setStatus('🔴 API Deriv non disponible');
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

                        const quote = Number(tick.quote);

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
                            !Number.isInteger(lastDigit) ||
                            lastDigit < 0 ||
                            lastDigit > 9
                        ) {
                            return;
                        }

                        setPrice(formattedPrice);
                        setDigit(String(lastDigit));

                        const oldHistory =
                            historyRef.current;

                        // =================================================
                        // PHASE 1 : CONSTITUTION DE LA BASE
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

                            // Pas encore de test.
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
                            predictionRef.current !== null
                        ) {
                            const currentPrediction =
                                predictionRef.current;

                            testsRef.current += 1;

                            setTests(
                                testsRef.current
                            );

                            if (
                                currentPrediction ===
                                lastDigit
                            ) {
                                successesRef.current += 1;

                                setSuccesses(
                                    successesRef.current
                                );
                            }
                        }

                        // =================================================
                        // AJOUT DU NOUVEAU TICK
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
                        // CALCUL DE LA NOUVELLE ANALYSE
                        // =================================================

                        if (
                            testsRef.current >=
                            TEST_LIMIT
                        ) {
                            return;
                        }

                        const recent =
                            nextHistory.slice(
                                -RECENT_SIZE
                            );

                        const globalCounts =
                            Array(10).fill(0);

                        const recentCounts =
                            Array(10).fill(0);

                        nextHistory.forEach(value => {
                            if (
                                value >= 0 &&
                                value <= 9
                            ) {
                                globalCounts[value]++;
                            }
                        });

                        recent.forEach(value => {
                            if (
                                value >= 0 &&
                                value <= 9
                            ) {
                                recentCounts[value]++;
                            }
                        });

                        // =================================================
                        // SCORE V2
                        // 50 % historique
                        // 50 % récent
                        // =================================================

                        const scores =
                            Array(10).fill(0);

                        for (
                            let i = 0;
                            i < 10;
                            i++
                        ) {
                            const globalFrequency =
                                globalCounts[i] /
                                HISTORY_SIZE;

                            const recentFrequency =
                                recentCounts[i] /
                                RECENT_SIZE;

                            scores[i] =
                                globalFrequency * 50 +
                                recentFrequency * 50;
                        }

                        let bestDigit = 0;

                        for (
                            let i = 1;
                            i < 10;
                            i++
                        ) {
                            if (
                                scores[i] >
                                scores[bestDigit]
                            ) {
                                bestDigit = i;
                            }
                        }

                        predictionRef.current =
                            bestDigit;
                    });

                // Une seule souscription R_75.
                api_base.api.send({
                    ticks: 'R_75',
                    subscribe: 1,
                });
            } catch (error) {
                console.error(
                    'R75 Tick Monitor error:',
                    error
                );

                setStatus('🔴 Erreur Deriv');
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
    // STATISTIQUES AFFICHÉES
    // =====================================================

    const globalCounts = Array(10).fill(0);
    const recentCounts = Array(10).fill(0);

    history.forEach(value => {
        if (value >= 0 && value <= 9) {
            globalCounts[value]++;
        }
    });

    const recent =
        history.slice(-RECENT_SIZE);

    recent.forEach(value => {
        if (value >= 0 && value <= 9) {
            recentCounts[value]++;
        }
    });

    const scores = Array(10).fill(0);

    for (let i = 0; i < 10; i++) {
        const globalFrequency =
            history.length > 0
                ? globalCounts[i] /
                  history.length
                : 0;

        const recentFrequency =
            recent.length > 0
                ? recentCounts[i] /
                  recent.length
                : 0;

        scores[i] =
            globalFrequency * 50 +
            recentFrequency * 50;
    }

    let bestDigit = 0;

    for (let i = 1; i < 10; i++) {
        if (
            scores[i] >
            scores[bestDigit]
        ) {
            bestDigit = i;
        }
    }

    const testRate =
        tests > 0
            ? (
                  (successes / tests) *
                  100
              ).toFixed(1)
            : '0.0';

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
                Moniteur de ticks R75 — V2.1
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
                Phase 1 — Base d'analyse
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
                    📊 Collecte de la base
                    de 500 ticks en cours...
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
                        Fréquence des 500 ticks
                    </h3>

                    {globalCounts.map(
                        (count, index) => (
                            <p key={index}>
                                <strong>
                                    {index} :
                                </strong>{' '}
                                {count} (
                                {(
                                    (count /
                                        HISTORY_SIZE) *
                                    100
                                ).toFixed(1)}
                                %)
                            </p>
                        )
                    )}

                    <hr />

                    <h3>
                        100 derniers ticks
                    </h3>

                    {recentCounts.map(
                        (count, index) => (
                            <p key={index}>
                                <strong>
                                    {index} :
                                </strong>{' '}
                                {count} (
                                {(
                                    (count /
                                        RECENT_SIZE) *
                                    100
                                ).toFixed(1)}
                                %)
                            </p>
                        )
                    )}

                    <hr />

                    <h3>
                        Score expérimental V2.1
                    </h3>

                    {scores.map(
                        (score, index) => (
                            <p key={index}>
                                <strong>
                                    {index} :
                                </strong>{' '}
                                {score.toFixed(2)}
                            </p>
                        )
                    )}

                    <p>
                        <strong>
                            Sélection expérimentale :
                        </strong>{' '}
                        {bestDigit}
                    </p>

                    <hr />

                    <h3>
                        Phase 2 — Test
                    </h3>

                    <p>
                        <strong>
                            Tests réalisés :
                        </strong>{' '}
                        {tests} / {TEST_LIMIT}
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

                    {tests >= TEST_LIMIT && (
                        <p>
                            ✅ Test de 3000 ticks
                            terminé.
                        </p>
                    )}

                    <hr />

                    <p>
                        ⚠️ Analyse statistique
                        expérimentale uniquement.
                    </p>

                    <p>
                        ❌ Aucun trade automatique.
                    </p>
                </>
            )}
        </div>
    );
};

export default R75TickMonitor;

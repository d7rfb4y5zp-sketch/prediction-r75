import React, { useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';

const TRAINING_SIZE = 200;
const TEST_TARGET = 500;

const R75TickMonitor = () => {
    const [status, setStatus] = useState('🟠 Connexion à Deriv…');
    const [price, setPrice] = useState('—');
    const [digit, setDigit] = useState('—');

    const [trainingTicks, setTrainingTicks] = useState<number[]>([]);
    const [predictions, setPredictions] = useState<number[]>([]);
    const [results, setResults] = useState<boolean[]>([]);

    const trainingRef = useRef<number[]>([]);
    const trainingCountsRef = useRef<number[]>(Array(10).fill(0));

    const predictionsRef = useRef<number[]>([]);
    const resultsRef = useRef<boolean[]>([]);

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
                        if (data?.msg_type !== 'tick') return;

                        const tick = data.tick;

                        if (!tick || tick.symbol !== 'R_75') return;

                        const quote = Number(tick.quote);

                        if (!Number.isFinite(quote)) return;

                        const pipSize = Number(tick.pip_size ?? 4);
                        const formattedPrice = quote.toFixed(pipSize);

                        const lastDigit = Number(
                            formattedPrice.replace('.', '').slice(-1)
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

                        // ==========================================
                        // PHASE 1 — APPRENTISSAGE
                        // ==========================================

                        if (
                            trainingRef.current.length <
                            TRAINING_SIZE
                        ) {
                            trainingRef.current.push(lastDigit);

                            trainingCountsRef.current[lastDigit]++;

                            setTrainingTicks([
                                ...trainingRef.current,
                            ]);

                            return;
                        }

                        // ==========================================
                        // PHASE 2 — TEST
                        // ==========================================

                        if (
                            resultsRef.current.length >=
                            TEST_TARGET
                        ) {
                            return;
                        }

                        const counts =
                            trainingCountsRef.current;

                        // Chiffre le plus fréquent
                        let prediction = 0;
                        let highestCount = counts[0];

                        for (let i = 1; i < 10; i++) {
                            if (counts[i] > highestCount) {
                                highestCount = counts[i];
                                prediction = i;
                            }
                        }

                        // Prédiction AVANT de regarder le résultat
                        const success =
                            prediction === lastDigit;

                        predictionsRef.current.push(
                            prediction
                        );

                        resultsRef.current.push(success);

                        setPredictions([
                            ...predictionsRef.current,
                        ]);

                        setResults([
                            ...resultsRef.current,
                        ]);
                    });

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

    // ==========================================
    // STATISTIQUES APPRENTISSAGE
    // ==========================================

    const trainingCounts =
        trainingCountsRef.current;

    const trainingTotal =
        trainingRef.current.length;

    let dominantDigit = 0;
    let dominantCount = trainingCounts[0];

    for (let i = 1; i < 10; i++) {
        if (trainingCounts[i] > dominantCount) {
            dominantCount = trainingCounts[i];
            dominantDigit = i;
        }
    }

    const dominantFrequency =
        trainingTotal > 0
            ? (
                  (dominantCount / trainingTotal) *
                  100
              ).toFixed(1)
            : '0.0';

    // ==========================================
    // TEST
    // ==========================================

    const testTotal = results.length;

    const successes = results.filter(
        result => result === true
    ).length;

    const failures = testTotal - successes;

    const testRate =
        testTotal > 0
            ? ((successes / testTotal) * 100).toFixed(1)
            : '0.0';

    const lastPredictions =
        predictions.slice(-20);

    const lastResults =
        results.slice(-20);

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
            <h2>Moniteur de ticks R75</h2>

            <p>
                <strong>Connexion :</strong>{' '}
                {status}
            </p>

            <p>
                <strong>Marché :</strong>{' '}
                Volatility 75 (R_75)
            </p>

            <p>
                <strong>Prix :</strong>{' '}
                {price}
            </p>

            <p>
                <strong>Dernier chiffre :</strong>{' '}
                {digit}
            </p>

            <hr />

            <h3>
                Phase 1 — Apprentissage rapide
            </h3>

            <p>
                <strong>
                    Ticks d'apprentissage :
                </strong>{' '}
                {trainingTotal} / {TRAINING_SIZE}
            </p>

            {trainingTotal < TRAINING_SIZE && (
                <p>
                    📊 Collecte rapide en cours...
                </p>
            )}

            {trainingTotal >= TRAINING_SIZE && (
                <>
                    <p>
                        ✅ Base de{' '}
                        {TRAINING_SIZE} ticks terminée.
                    </p>

                    <p>
                        🔒 Base d'apprentissage
                        verrouillée.
                    </p>

                    <p>
                        <strong>
                            Chiffre dominant :
                        </strong>{' '}
                        {dominantDigit}
                    </p>

                    <p>
                        <strong>
                            Occurrences :
                        </strong>{' '}
                        {dominantCount} /{' '}
                        {TRAINING_SIZE}
                    </p>

                    <p>
                        <strong>
                            Fréquence :
                        </strong>{' '}
                        {dominantFrequency}%
                    </p>

                    <h3>
                        Répartition de la base
                    </h3>

                    {trainingCounts.map(
                        (count, index) => {
                            const percentage =
                                trainingTotal > 0
                                    ? (
                                          (count /
                                              trainingTotal) *
                                          100
                                      ).toFixed(1)
                                    : '0.0';

                            return (
                                <p key={index}>
                                    <strong>
                                        {index} :
                                    </strong>{' '}
                                    {count} (
                                    {percentage}%)
                                </p>
                            );
                        }
                    )}
                </>
            )}

            <hr />

            <h3>
                Phase 2 — Test hors-échantillon
            </h3>

            {trainingTotal <
                TRAINING_SIZE && (
                <p>
                    ⏳ Le test commencera après
                    les {TRAINING_SIZE} ticks.
                </p>
            )}

            {trainingTotal >=
                TRAINING_SIZE &&
                testTotal === 0 && (
                    <p>
                        🧪 Base terminée. Le test
                        commence avec les nouveaux
                        ticks...
                    </p>
                )}

            {testTotal > 0 && (
                <>
                    <p>
                        <strong>
                            Tests réalisés :
                        </strong>{' '}
                        {testTotal} / {TEST_TARGET}
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
                        {failures}
                    </p>

                    <p>
                        <strong>
                            Taux observé :
                        </strong>{' '}
                        {testRate}%
                    </p>
                </>
            )}

            {testTotal >= 20 && (
                <>
                    <hr />

                    <h3>
                        20 derniers tests
                    </h3>

                    {lastPredictions.map(
                        (prediction, index) => {
                            const result =
                                lastResults[index];

                            const testNumber =
                                testTotal -
                                lastPredictions.length +
                                index +
                                1;

                            return (
                                <p key={index}>
                                    Test {testNumber} :
                                    prédiction{' '}
                                    <strong>
                                        {prediction}
                                    </strong>{' '}
                                    →{' '}
                                    {result
                                        ? '✅ réussi'
                                        : '❌ échec'}
                                </p>
                            );
                        }
                    )}
                </>
            )}

            {testTotal >= TEST_TARGET && (
                <>
                    <hr />

                    <h3>
                        🧪 Test terminé
                    </h3>

                    <p>
                        <strong>
                            Échantillon :
                        </strong>{' '}
                        {TEST_TARGET} nouveaux
                        ticks
                    </p>

                    <p>
                        <strong>
                            Résultat :
                        </strong>{' '}
                        {successes} /{' '}
                        {TEST_TARGET}
                    </p>

                    <p>
                        <strong>
                            Taux final :
                        </strong>{' '}
                        {testRate}%
                    </p>

                    <p>
                        📌 Référence uniforme :
                        environ 10 %.
                    </p>
                </>
            )}

            <hr />

            <p>
                🔒 La base de {TRAINING_SIZE}{' '}
                ticks reste fixe pendant le test.
            </p>

            <p>
                ⚠️ Analyse expérimentale uniquement.
            </p>

            <p>
                ❌ Aucun trade automatique.
            </p>
        </div>
    );
};

export default R75TickMonitor;

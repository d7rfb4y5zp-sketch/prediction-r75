import React, { useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';

const R75TickMonitor = () => {
    const [status, setStatus] = useState('🟠 Connexion à Deriv…');
    const [price, setPrice] = useState('—');
    const [digit, setDigit] = useState('—');

    // Affichage de la base d'apprentissage
    const [trainingTicks, setTrainingTicks] = useState<number[]>([]);

    // Résultats du test hors-échantillon
    const [predictions, setPredictions] = useState<number[]>([]);
    const [results, setResults] = useState<boolean[]>([]);

    // Refs pour conserver les données sans problème de fermeture React
    const trainingRef = useRef<number[]>([]);
    const trainingCountsRef = useRef<number[]>(Array(10).fill(0));
    const testPredictionsRef = useRef<number[]>([]);
    const testResultsRef = useRef<boolean[]>([]);

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
                        // PHASE 1 : CONSTRUCTION DES 1000 TICKS
                        // ==========================================

                        if (trainingRef.current.length < 1000) {
                            trainingRef.current.push(lastDigit);

                            trainingCountsRef.current[lastDigit]++;

                            setTrainingTicks([
                                ...trainingRef.current,
                            ]);

                            return;
                        }

                        // ==========================================
                        // PHASE 2 : TEST HORS-ÉCHANTILLON
                        // ==========================================

                        // IMPORTANT :
                        // La base de 1000 ticks reste FIXE.
                        const counts = trainingCountsRef.current;

                        let prediction = 0;
                        let highestCount = counts[0];

                        for (let i = 1; i < 10; i++) {
                            if (counts[i] > highestCount) {
                                highestCount = counts[i];
                                prediction = i;
                            }
                        }

                        // On prédit AVANT d'utiliser le nouveau tick.
                        const success = prediction === lastDigit;

                        testPredictionsRef.current.push(prediction);
                        testResultsRef.current.push(success);

                        setPredictions([
                            ...testPredictionsRef.current,
                        ]);

                        setResults([
                            ...testResultsRef.current,
                        ]);
                    });

                api_base.api.send({
                    ticks: 'R_75',
                    subscribe: 1,
                });
            } catch (error) {
                console.error('R75 Tick Monitor error:', error);
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

    // ==================================================
    // STATISTIQUES DE LA BASE FIXE
    // ==================================================

    const trainingCounts = trainingCountsRef.current;

    const trainingTotal = trainingRef.current.length;

    let trainingMostFrequent = 0;
    let trainingHighestCount = trainingCounts[0];

    for (let i = 1; i < 10; i++) {
        if (trainingCounts[i] > trainingHighestCount) {
            trainingHighestCount = trainingCounts[i];
            trainingMostFrequent = i;
        }
    }

    const trainingFrequency =
        trainingTotal > 0
            ? ((trainingHighestCount / trainingTotal) * 100).toFixed(1)
            : '0.0';

    // ==================================================
    // RÉSULTATS DU TEST
    // ==================================================

    const testTotal = results.length;

    const successes = results.filter(
        result => result === true
    ).length;

    const failures = testTotal - successes;

    const testRate =
        testTotal > 0
            ? ((successes / testTotal) * 100).toFixed(1)
            : '0.0';

    // ==================================================
    // DERNIERS TESTS
    // ==================================================

    const lastTests = predictions.slice(-20);
    const lastResults = results.slice(-20);

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
                <strong>Connexion :</strong> {status}
            </p>

            <p>
                <strong>Marché :</strong> Volatility 75 (R_75)
            </p>

            <p>
                <strong>Prix :</strong> {price}
            </p>

            <p>
                <strong>Dernier chiffre :</strong> {digit}
            </p>

            <hr />

            <h3>Phase 1 — Base d'apprentissage</h3>

            <p>
                <strong>Ticks de référence :</strong>{' '}
                {trainingTotal} / 1000
            </p>

            {trainingTotal < 1000 && (
                <p>
                    📊 Construction de la base statistique...
                </p>
            )}

            {trainingTotal >= 1000 && (
                <>
                    <p>
                        ✅ Base de 1000 ticks terminée.
                    </p>

                    <p>
                        🔒 Base d'apprentissage verrouillée.
                    </p>

                    <p>
                        <strong>Chiffre dominant :</strong>{' '}
                        {trainingMostFrequent}
                    </p>

                    <p>
                        <strong>Occurrences :</strong>{' '}
                        {trainingHighestCount} / 1000
                    </p>

                    <p>
                        <strong>Fréquence :</strong>{' '}
                        {trainingFrequency}%
                    </p>

                    <hr />

                    <h3>Répartition de la base fixe</h3>

                    {trainingCounts.map((count, index) => {
                        const percentage =
                            ((count / 1000) * 100).toFixed(1);

                        return (
                            <p key={index}>
                                <strong>{index} :</strong>{' '}
                                {count} ({percentage}%)
                            </p>
                        );
                    })}
                </>
            )}

            <hr />

            <h3>Phase 2 — Test hors-échantillon</h3>

            {trainingTotal < 1000 && (
                <p>
                    ⏳ Le test commencera après les 1000 ticks
                    d'apprentissage.
                </p>
            )}

            {trainingTotal >= 1000 && testTotal === 0 && (
                <p>
                    🧪 Base terminée. En attente des nouveaux ticks
                    pour commencer le test...
                </p>
            )}

            {testTotal > 0 && (
                <>
                    <p>
                        <strong>Tests réalisés :</strong>{' '}
                        {testTotal}
                    </p>

                    <p>
                        <strong>Réussites :</strong>{' '}
                        {successes}
                    </p>

                    <p>
                        <strong>Échecs :</strong>{' '}
                        {failures}
                    </p>

                    <p>
                        <strong>Taux observé :</strong>{' '}
                        {testRate}%
                    </p>

                    <p>
                        📌 Référence uniforme : environ 10 % par
                        chiffre.
                    </p>
                </>
            )}

            {testTotal >= 20 && (
                <>
                    <hr />

                    <h3>20 derniers tests</h3>

                    {lastTests.map((prediction, index) => {
                        const result = lastResults[index];

                        const testNumber =
                            testTotal - lastTests.length + index + 1;

                        return (
                            <p key={index}>
                                Test {testNumber} : prédiction{' '}
                                <strong>{prediction}</strong> →{' '}
                                {result
                                    ? '✅ réussi'
                                    : '❌ échec'}
                            </p>
                        );
                    })}
                </>
            )}

            {testTotal >= 100 && (
                <>
                    <hr />

                    <h3>🧪 Premier bilan</h3>

                    <p>
                        <strong>Échantillon de test :</strong>{' '}
                        {testTotal} nouveaux ticks
                    </p>

                    <p>
                        <strong>Réussites :</strong>{' '}
                        {successes} / {testTotal}
                    </p>

                    <p>
                        <strong>Taux :</strong>{' '}
                        {testRate}%
                    </p>

                    <p>
                        ⚠️ Ce résultat mesure cette méthode sur
                        des données nouvelles. Il ne constitue pas
                        une garantie de prédiction future.
                    </p>
                </>
            )}

            <hr />

            <p>
                🔒 Les 1000 ticks d'apprentissage restent fixes
                pendant le test.
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

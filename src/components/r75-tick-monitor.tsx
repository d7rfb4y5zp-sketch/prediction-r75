import React, { useEffect, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';

const R75TickMonitor = () => {
    const [status, setStatus] = useState('🟠 Connexion à Deriv…');
    const [price, setPrice] = useState('—');
    const [digit, setDigit] = useState('—');

    const [digits, setDigits] = useState<number[]>([]);

    const [testPredictions, setTestPredictions] = useState<number[]>([]);
    const [testResults, setTestResults] = useState<boolean[]>([]);

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

                        setDigits(prev => {
                            const previous = [...prev];

                            /*
                             * Tant que nous n'avons pas 1000 ticks,
                             * nous construisons notre référence.
                             */
                            if (previous.length < 1000) {
                                return [...previous, lastDigit];
                            }

                            /*
                             * À partir du 1001e tick :
                             * la prédiction est calculée uniquement
                             * à partir des données déjà observées.
                             */
                            const counts = Array(10).fill(0);

                            previous.forEach(value => {
                                if (value >= 0 && value <= 9) {
                                    counts[value]++;
                                }
                            });

                            let prediction = 0;
                            let bestCount = counts[0];

                            for (let i = 1; i < 10; i++) {
                                if (counts[i] > bestCount) {
                                    bestCount = counts[i];
                                    prediction = i;
                                }
                            }

                            const success = prediction === lastDigit;

                            setTestPredictions(old => [
                                ...old,
                                prediction,
                            ]);

                            setTestResults(old => [
                                ...old,
                                success,
                            ]);

                            /*
                             * Fenêtre glissante :
                             * on retire le plus ancien tick et
                             * on ajoute le nouveau.
                             */
                            previous.shift();
                            previous.push(lastDigit);

                            return previous;
                        });
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
    // STATISTIQUES DES 1000 TICKS ACTUELS
    // ==================================================

    const counts: number[] = Array(10).fill(0);

    digits.forEach(value => {
        if (value >= 0 && value <= 9) {
            counts[value]++;
        }
    });

    const totalTicks = digits.length;

    let mostFrequentDigit = 0;
    let highestCount = counts[0];

    for (let i = 1; i < 10; i++) {
        if (counts[i] > highestCount) {
            highestCount = counts[i];
            mostFrequentDigit = i;
        }
    }

    const mostFrequentPercentage =
        totalTicks > 0
            ? ((highestCount / totalTicks) * 100).toFixed(1)
            : '0.0';

    // ==================================================
    // TEST HORS-ÉCHANTILLON
    // ==================================================

    const testCount = testResults.length;

    const successCount = testResults.filter(
        result => result === true
    ).length;

    const failureCount = testCount - successCount;

    const successRate =
        testCount > 0
            ? ((successCount / testCount) * 100).toFixed(1)
            : '0.0';

    // ==================================================
    // DERNIÈRES PRÉDICTIONS
    // ==================================================

    const recentPredictions = testPredictions.slice(-20);
    const recentResults = testResults.slice(-20);

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

            <h3>Base statistique</h3>

            <p>
                <strong>Ticks de référence :</strong>{' '}
                {totalTicks} / 1000
            </p>

            {totalTicks < 1000 && (
                <p>
                    📊 Construction de la base statistique...
                </p>
            )}

            {totalTicks >= 1000 && (
                <>
                    <p>
                        ✅ Base de 1000 ticks disponible.
                    </p>

                    <p>
                        <strong>Chiffre le plus fréquent :</strong>{' '}
                        {mostFrequentDigit}
                    </p>

                    <p>
                        <strong>Occurrences :</strong>{' '}
                        {highestCount} / 1000
                    </p>

                    <p>
                        <strong>Fréquence :</strong>{' '}
                        {mostFrequentPercentage}%
                    </p>
                </>
            )}

            <hr />

            <h3>Test hors-échantillon</h3>

            {testCount === 0 && (
                <p>
                    ⏳ Le test commencera après les 1000 ticks
                    de référence.
                </p>
            )}

            {testCount > 0 && (
                <>
                    <p>
                        <strong>Prédictions testées :</strong>{' '}
                        {testCount}
                    </p>

                    <p>
                        <strong>Réussites :</strong>{' '}
                        {successCount}
                    </p>

                    <p>
                        <strong>Échecs :</strong>{' '}
                        {failureCount}
                    </p>

                    <p>
                        <strong>Taux observé :</strong>{' '}
                        {successRate}%
                    </p>
                </>
            )}

            {testCount >= 20 && (
                <>
                    <hr />

                    <h3>20 derniers tests</h3>

                    {recentPredictions.map((prediction, index) => {
                        const result = recentResults[index];

                        return (
                            <p key={index}>
                                Test {testCount - 19 + index} :
                                prédiction{' '}
                                <strong>{prediction}</strong>{' '}
                                →{' '}
                                {result ? '✅ réussi' : '❌ échec'}
                            </p>
                        );
                    })}
                </>
            )}

            <hr />

            <p>
                📌 La prédiction actuelle utilise uniquement les
                données déjà observées avant chaque nouveau tick.
            </p>

            <p>
                ⚠️ Un taux observé sur quelques tests ne constitue
                pas une preuve de pouvoir prédictif.
            </p>

            <p>
                ❌ Aucun trade automatique.
            </p>
        </div>
    );
};

export default R75TickMonitor;

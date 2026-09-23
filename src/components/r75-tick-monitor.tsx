import React, { useEffect, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';

const LEARNING_SIZE = 200;
const BLOCK_SIZE = 100;
const MAX_TESTS = 3000;

const R75TickMonitor = () => {
    const [status, setStatus] = useState('🟠 Connexion à Deriv…');
    const [price, setPrice] = useState('—');
    const [digit, setDigit] = useState('—');

    const [learningDigits, setLearningDigits] = useState<number[]>([]);
    const [testCount, setTestCount] = useState(0);
    const [successCount, setSuccessCount] = useState(0);
    const [failureCount, setFailureCount] = useState(0);

    const [blockResults, setBlockResults] = useState<number[]>([]);
    const [currentBlockSuccess, setCurrentBlockSuccess] = useState(0);

    const [prediction, setPrediction] = useState<number | null>(null);

    useEffect(() => {
        let subscription: any;

        const connect = () => {
            try {
                if (!api_base.api) {
                    setStatus('🔴 API Deriv non disponible');
                    return;
                }

                setStatus('🟢 Connecté à Deriv');

                subscription = api_base.api.onMessage().subscribe(({ data }: any) => {
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

                    setPrice(formattedPrice);
                    setDigit(String(lastDigit));

                    // PHASE 1 : apprentissage
                    if (learningDigits.length < LEARNING_SIZE) {
                        setLearningDigits(prev => [...prev, lastDigit]);
                        return;
                    }

                    // Une seule prédiction basée sur les 200 ticks d'apprentissage.
                    const counts = Array(10).fill(0);

                    learningDigits.forEach(value => {
                        if (value >= 0 && value <= 9) {
                            counts[value]++;
                        }
                    });

                    const dominantDigit = counts.indexOf(Math.max(...counts));

                    setPrediction(dominantDigit);

                    // PHASE 2 : test hors-échantillon
                    if (testCount >= MAX_TESTS) return;

                    const success = lastDigit === dominantDigit;

                    setTestCount(prev => prev + 1);

                    if (success) {
                        setSuccessCount(prev => prev + 1);
                    } else {
                        setFailureCount(prev => prev + 1);
                    }

                    // Gestion du bloc de 100 tests
                    setCurrentBlockSuccess(prev => {
                        const newValue = prev + (success ? 1 : 0);

                        if (testCount + 1 >= BLOCK_SIZE) {
                            setBlockResults(blocks => [...blocks, newValue]);
                            return 0;
                        }

                        return newValue;
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
    }, [learningDigits, testCount]);

    const learningCounts = Array(10).fill(0);

    learningDigits.forEach(value => {
        if (value >= 0 && value <= 9) {
            learningCounts[value]++;
        }
    });

    const dominantDigit =
        learningDigits.length > 0
            ? learningCounts.indexOf(Math.max(...learningCounts))
            : null;

    const dominantCount =
        dominantDigit !== null ? learningCounts[dominantDigit] : 0;

    const testRate =
        testCount > 0
            ? ((successCount / testCount) * 100).toFixed(1)
            : '0.0';

    const completedBlocks = blockResults.length;

    const blockAverage =
        completedBlocks > 0
            ? (
                  blockResults.reduce((sum, value) => sum + value, 0) /
                  completedBlocks
              ).toFixed(2)
            : '—';

    const minBlock =
        completedBlocks > 0 ? Math.min(...blockResults) : null;

    const maxBlock =
        completedBlocks > 0 ? Math.max(...blockResults) : null;

    const blocksBetween10And11 = blockResults.filter(
        value => value === 10 || value === 11
    ).length;

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

            <h3>Phase 1 — Apprentissage rapide</h3>

            <p>
                <strong>Ticks d'apprentissage :</strong>{' '}
                {learningDigits.length} / {LEARNING_SIZE}
            </p>

            {learningDigits.length < LEARNING_SIZE ? (
                <p>📊 Collecte de la base d'apprentissage...</p>
            ) : (
                <>
                    <p>✅ Base de {LEARNING_SIZE} ticks terminée.</p>

                    <p>
                        🔒 Base d'apprentissage verrouillée.
                    </p>

                    <p>
                        <strong>Chiffre dominant :</strong>{' '}
                        {dominantDigit}
                    </p>

                    <p>
                        <strong>Occurrences :</strong>{' '}
                        {dominantCount} / {LEARNING_SIZE}
                    </p>

                    <p>
                        <strong>Fréquence :</strong>{' '}
                        {(
                            (dominantCount / LEARNING_SIZE) *
                            100
                        ).toFixed(1)}
                        %
                    </p>

                    <h3>Répartition de la base</h3>

                    {learningCounts.map((count, index) => (
                        <p key={index}>
                            <strong>{index} :</strong> {count} (
                            {((count / LEARNING_SIZE) * 100).toFixed(1)}
                            %)
                        </p>
                    ))}
                </>
            )}

            {learningDigits.length >= LEARNING_SIZE && (
                <>
                    <hr />

                    <h3>Phase 2 — Test par blocs de 100</h3>

                    <p>
                        <strong>Tests réalisés :</strong>{' '}
                        {testCount} / {MAX_TESTS}
                    </p>

                    <p>
                        <strong>Réussites :</strong> {successCount}
                    </p>

                    <p>
                        <strong>Échecs :</strong> {failureCount}
                    </p>

                    <p>
                        <strong>Taux observé :</strong> {testRate}%
                    </p>

                    <p>
                        <strong>Prédiction actuelle :</strong>{' '}
                        {prediction}
                    </p>

                    <hr />

                    <h3>📊 Analyse des blocs de 100</h3>

                    <p>
                        <strong>Blocs terminés :</strong>{' '}
                        {completedBlocks}
                    </p>

                    {blockResults.length === 0 ? (
                        <p>
                            ⏳ Premier bloc de 100 tests en cours...
                        </p>
                    ) : (
                        <>
                            {blockResults.map((value, index) => (
                                <p key={index}>
                                    <strong>
                                        Bloc {index + 1} :
                                    </strong>{' '}
                                    {value} / 100 (
                                    {value.toFixed(1)}%)
                                </p>
                            ))}

                            <hr />

                            <p>
                                <strong>
                                    Moyenne par bloc :
                                </strong>{' '}
                                {blockAverage} / 100
                            </p>

                            <p>
                                <strong>
                                    Minimum :
                                </strong>{' '}
                                {minBlock} / 100
                            </p>

                            <p>
                                <strong>
                                    Maximum :
                                </strong>{' '}
                                {maxBlock} / 100
                            </p>

                            <p>
                                <strong>
                                    Blocs à 10 ou 11 réussites :
                                </strong>{' '}
                                {blocksBetween10And11} /{' '}
                                {completedBlocks}
                            </p>
                        </>
                    )}

                    <hr />

                    <p>
                        📌 Référence théorique : environ 10 réussites
                        sur 100 pour un chiffre donné.
                    </p>

                    <p>
                        ⚠️ Ce test mesure uniquement les données
                        observées. Il ne garantit pas le prochain
                        chiffre.
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

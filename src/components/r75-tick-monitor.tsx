import React, { useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';

const LEARNING_SIZE = 200;
const BLOCK_SIZE = 100;
const MAX_BLOCKS = 30;

const R75TickMonitor = () => {
    const [status, setStatus] = useState('🟠 Connexion à Deriv…');
    const [price, setPrice] = useState('—');
    const [digit, setDigit] = useState('—');

    const [learningCount, setLearningCount] = useState(0);
    const [learningCounts, setLearningCounts] = useState<number[]>(
        Array(10).fill(0)
    );

    const [testCount, setTestCount] = useState(0);
    const [successCount, setSuccessCount] = useState(0);
    const [failureCount, setFailureCount] = useState(0);

    const [blockResults, setBlockResults] = useState<number[]>([]);
    const [currentBlockSuccess, setCurrentBlockSuccess] = useState(0);

    const learningDigitsRef = useRef<number[]>([]);
    const learningCountsRef = useRef<number[]>(Array(10).fill(0));

    const testCountRef = useRef(0);
    const successCountRef = useRef(0);
    const failureCountRef = useRef(0);

    const currentBlockSuccessRef = useRef(0);
    const blockResultsRef = useRef<number[]>([]);

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

                        if (!tick || tick.symbol !== 'R_75') {
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

                        // ==========================================
                        // PHASE 1 : APPRENTISSAGE
                        // ==========================================

                        if (
                            learningDigitsRef.current.length <
                            LEARNING_SIZE
                        ) {
                            learningDigitsRef.current.push(
                                lastDigit
                            );

                            learningCountsRef.current[
                                lastDigit
                            ]++;

                            setLearningCount(
                                learningDigitsRef.current.length
                            );

                            setLearningCounts([
                                ...learningCountsRef.current,
                            ]);

                            return;
                        }

                        // ==========================================
                        // PHASE 2 : TEST
                        // ==========================================

                        if (
                            blockResultsRef.current.length >=
                            MAX_BLOCKS
                        ) {
                            return;
                        }

                        const counts =
                            learningCountsRef.current;

                        // Chiffre dominant de la base
                        let prediction = 0;
                        let highestCount = counts[0];

                        for (let i = 1; i < 10; i++) {
                            if (counts[i] > highestCount) {
                                highestCount = counts[i];
                                prediction = i;
                            }
                        }

                        // On compare la prédiction au nouveau tick
                        const success =
                            prediction === lastDigit;

                        testCountRef.current += 1;

                        if (success) {
                            successCountRef.current += 1;
                            currentBlockSuccessRef.current += 1;
                        } else {
                            failureCountRef.current += 1;
                        }

                        setTestCount(testCountRef.current);
                        setSuccessCount(
                            successCountRef.current
                        );
                        setFailureCount(
                            failureCountRef.current
                        );
                        setCurrentBlockSuccess(
                            currentBlockSuccessRef.current
                        );

                        // ==========================================
                        // FIN D'UN BLOC DE 100
                        // ==========================================

                        if (
                            testCountRef.current %
                                BLOCK_SIZE ===
                            0
                        ) {
                            const completedBlock =
                                currentBlockSuccessRef.current;

                            blockResultsRef.current = [
                                ...blockResultsRef.current,
                                completedBlock,
                            ];

                            setBlockResults([
                                ...blockResultsRef.current,
                            ]);

                            currentBlockSuccessRef.current = 0;

                            setCurrentBlockSuccess(0);
                        }
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

    // ==================================================
    // STATISTIQUES APPRENTISSAGE
    // ==================================================

    const dominantDigit =
        learningCount >= LEARNING_SIZE
            ? learningCounts.indexOf(
                  Math.max(...learningCounts)
              )
            : null;

    const dominantCount =
        dominantDigit !== null
            ? learningCounts[dominantDigit]
            : 0;

    const dominantFrequency =
        learningCount > 0
            ? (
                  (dominantCount / learningCount) *
                  100
              ).toFixed(1)
            : '0.0';

    // ==================================================
    // STATISTIQUES TEST
    // ==================================================

    const testRate =
        testCount > 0
            ? (
                  (successCount / testCount) *
                  100
              ).toFixed(1)
            : '0.0';

    const completedBlocks = blockResults.length;

    const blockAverage =
        completedBlocks > 0
            ? (
                  blockResults.reduce(
                      (sum, value) => sum + value,
                      0
                  ) / completedBlocks
              ).toFixed(2)
            : '—';

    const minBlock =
        completedBlocks > 0
            ? Math.min(...blockResults)
            : '—';

    const maxBlock =
        completedBlocks > 0
            ? Math.max(...blockResults)
            : '—';

    const blocks10or11 = blockResults.filter(
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
                Phase 1 — Apprentissage
            </h3>

            <p>
                <strong>
                    Ticks d'apprentissage :
                </strong>{' '}
                {learningCount} / {LEARNING_SIZE}
            </p>

            {learningCount < LEARNING_SIZE && (
                <p>
                    📊 Construction de la base...
                </p>
            )}

            {learningCount >= LEARNING_SIZE && (
                <>
                    <p>
                        ✅ Base de {LEARNING_SIZE}{' '}
                        ticks terminée.
                    </p>

                    <p>
                        🔒 Base verrouillée.
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
                        {LEARNING_SIZE}
                    </p>

                    <p>
                        <strong>
                            Fréquence :
                        </strong>{' '}
                        {dominantFrequency}%
                    </p>

                    <h3>
                        Répartition
                    </h3>

                    {learningCounts.map(
                        (count, index) => (
                            <p key={index}>
                                <strong>
                                    {index} :
                                </strong>{' '}
                                {count} (
                                {(
                                    (count /
                                        LEARNING_SIZE) *
                                    100
                                ).toFixed(1)}
                                %)
                            </p>
                        )
                    )}
                </>
            )}

            {learningCount >= LEARNING_SIZE && (
                <>
                    <hr />

                    <h3>
                        Phase 2 — Test par blocs
                    </h3>

                    <p>
                        <strong>
                            Tests réalisés :
                        </strong>{' '}
                        {testCount} /{' '}
                        {MAX_BLOCKS * BLOCK_SIZE}
                    </p>

                    <p>
                        <strong>
                            Réussites :
                        </strong>{' '}
                        {successCount}
                    </p>

                    <p>
                        <strong>
                            Échecs :
                        </strong>{' '}
                        {failureCount}
                    </p>

                    <p>
                        <strong>
                            Taux observé :
                        </strong>{' '}
                        {testRate}%
                    </p>

                    <p>
                        <strong>
                            Bloc actuel :
                        </strong>{' '}
                        {currentBlockSuccess} /{' '}
                        {BLOCK_SIZE}
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
                        (value, index) => (
                            <p key={index}>
                                <strong>
                                    Bloc {index + 1} :
                                </strong>{' '}
                                {value} / 100 (
                                {value.toFixed(1)}
                                %)
                            </p>
                        )
                    )}

                    {completedBlocks > 0 && (
                        <>
                            <hr />

                            <p>
                                <strong>
                                    Moyenne :
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
                                    Blocs à 10 ou 11 :
                                </strong>{' '}
                                {blocks10or11} /{' '}
                                {completedBlocks}
                            </p>
                        </>
                    )}

                    <hr />

                    <p>
                        📌 Référence : environ 10
                        réussites sur 100.
                    </p>

                    <p>
                        ⚠️ Test statistique uniquement.
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

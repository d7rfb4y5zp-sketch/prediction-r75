import React, { useEffect, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';

const R75TickMonitor = () => {
    const [status, setStatus] = useState('🟠 Connexion à Deriv…');
    const [price, setPrice] = useState('—');
    const [digit, setDigit] = useState('—');
    const [digits, setDigits] = useState<number[]>([]);

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
                            const next = [...prev, lastDigit];

                            if (next.length > 1000) {
                                next.shift();
                            }

                            return next;
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
    // STATISTIQUES DES 100 DERNIERS TICKS
    // ==================================================

    const recentDigits = digits.slice(-100);

    const counts100: number[] = Array(10).fill(0);

    recentDigits.forEach(value => {
        if (value >= 0 && value <= 9) {
            counts100[value]++;
        }
    });

    const maxCount100 = Math.max(...counts100);
    const mostFrequent100 = counts100.indexOf(maxCount100);

    const frequency100 =
        recentDigits.length > 0
            ? ((maxCount100 / recentDigits.length) * 100).toFixed(1)
            : '0.0';

    // ==================================================
    // STATISTIQUES DES 1000 TICKS
    // ==================================================

    const counts1000: number[] = Array(10).fill(0);

    digits.forEach(value => {
        if (value >= 0 && value <= 9) {
            counts1000[value]++;
        }
    });

    const maxCount1000 = Math.max(...counts1000);
    const mostFrequent1000 = counts1000.indexOf(maxCount1000);

    const frequency1000 =
        digits.length > 0
            ? ((maxCount1000 / digits.length) * 100).toFixed(1)
            : '0.0';

    // ==================================================
    // PLUS GRAND ÉCART PAR RAPPORT À 10 %
    // ==================================================

    let largestDeviation = 0;
    let largestDeviationDigit = 0;

    if (digits.length > 0) {
        counts1000.forEach((count, index) => {
            const percentage = (count / digits.length) * 100;
            const deviation = Math.abs(percentage - 10);

            if (deviation > largestDeviation) {
                largestDeviation = deviation;
                largestDeviationDigit = index;
            }
        });
    }

    // ==================================================
    // PLUS LONGUE SÉRIE D'UN MÊME CHIFFRE
    // ==================================================

    let currentStreak = 0;
    let currentStreakDigit: number | null = null;

    let longestStreak = 0;
    let longestStreakDigit: number | null = null;

    digits.forEach(value => {
        if (value === currentStreakDigit) {
            currentStreak++;
        } else {
            currentStreak = 1;
            currentStreakDigit = value;
        }

        if (currentStreak > longestStreak) {
            longestStreak = currentStreak;
            longestStreakDigit = value;
        }
    });

    // ==================================================
    // BLOCS DE 100 TICKS
    // ==================================================

    const fullBlockCount = Math.floor(digits.length / 100);

    const blocks = [];

    for (let blockIndex = 0; blockIndex < fullBlockCount; blockIndex++) {
        const start = blockIndex * 100;
        const end = start + 100;

        const block = digits.slice(start, end);

        const blockCounts: number[] = Array(10).fill(0);

        block.forEach(value => {
            if (value >= 0 && value <= 9) {
                blockCounts[value]++;
            }
        });

        const blockMax = Math.max(...blockCounts);
        const blockMostFrequent = blockCounts.indexOf(blockMax);

        blocks.push({
            number: blockIndex + 1,
            mostFrequent: blockMostFrequent,
            count: blockMax,
            frequency: ((blockMax / 100) * 100).toFixed(1),
        });
    }

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

            <h3>Collecte des données</h3>

            <p>
                <strong>Ticks collectés :</strong>{' '}
                {digits.length} / 1000
            </p>

            <p>
                {digits.length < 1000
                    ? '📊 Collecte des données en cours...'
                    : '✅ 1000 ticks disponibles pour analyse'}
            </p>

            <hr />

            <h3>Statistiques — 100 derniers ticks</h3>

            {counts100.map((count, index) => {
                const percentage =
                    recentDigits.length > 0
                        ? ((count / recentDigits.length) * 100).toFixed(1)
                        : '0.0';

                return (
                    <p key={`recent-${index}`}>
                        <strong>{index} :</strong> {count} ({percentage}%)
                    </p>
                );
            })}

            {recentDigits.length >= 100 && (
                <>
                    <p>
                        <strong>Plus fréquent :</strong>{' '}
                        {mostFrequent100}
                    </p>

                    <p>
                        <strong>Occurrences :</strong>{' '}
                        {maxCount100} / 100
                    </p>

                    <p>
                        <strong>Fréquence :</strong>{' '}
                        {frequency100}%
                    </p>
                </>
            )}

            <hr />

            <h3>Statistiques — historique</h3>

            {counts1000.map((count, index) => {
                const percentage =
                    digits.length > 0
                        ? ((count / digits.length) * 100).toFixed(1)
                        : '0.0';

                const deviation =
                    digits.length > 0
                        ? ((count / digits.length) * 100 - 10).toFixed(1)
                        : '0.0';

                return (
                    <p key={`all-${index}`}>
                        <strong>{index} :</strong> {count} ({percentage}%)
                        {' — écart : '}
                        {Number(deviation) >= 0 ? '+' : ''}
                        {deviation}%
                    </p>
                );
            })}

            {digits.length >= 1000 && (
                <>
                    <p>
                        <strong>
                            Plus fréquent sur 1000 :
                        </strong>{' '}
                        {mostFrequent1000}
                    </p>

                    <p>
                        <strong>Occurrences :</strong>{' '}
                        {maxCount1000} / 1000
                    </p>

                    <p>
                        <strong>Fréquence :</strong>{' '}
                        {frequency1000}%
                    </p>

                    <p>
                        <strong>
                            Plus grand écart à 10 % :
                        </strong>{' '}
                        chiffre {largestDeviationDigit}{' '}
                        ({largestDeviation.toFixed(1)} point(s))
                    </p>

                    <p>
                        <strong>
                            Plus longue série :
                        </strong>{' '}
                        {longestStreak} fois le chiffre{' '}
                        {longestStreakDigit}
                    </p>
                </>
            )}

            <hr />

            <h3>Analyse par blocs de 100</h3>

            {blocks.length === 0 && (
                <p>
                    📊 Premier bloc de 100 ticks en préparation...
                </p>
            )}

            {blocks.map(block => (
                <p key={block.number}>
                    <strong>
                        Bloc {block.number} :
                    </strong>{' '}
                    chiffre {block.mostFrequent},{' '}
                    {block.count}/100 ({block.frequency}%)
                </p>
            ))}

            <hr />

            <p>
                📌 Référence théorique utilisée pour comparaison :
                chaque chiffre = 10 %.
            </p>

            <p>
                ⚠️ Ces statistiques décrivent les données observées.
                Elles ne garantissent pas le prochain chiffre.
            </p>

            <p>
                ❌ Aucun trade automatique.
            </p>
        </div>
    );
};

export default R75TickMonitor;

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

                subscription = api_base.api.onMessage().subscribe(({ data }: any) => {
                    if (data?.msg_type !== 'tick') return;

                    const tick = data.tick;

                    if (!tick || tick.symbol !== 'R_75') return;

                    const quote = Number(tick.quote);

                    if (!Number.isFinite(quote)) return;

                    const pipSize = Number(tick.pip_size ?? 4);
                    const formattedPrice = quote.toFixed(pipSize);

                    const lastDigit = Number(formattedPrice.replace('.', '').slice(-1));

                    setPrice(formattedPrice);
                    setDigit(String(lastDigit));

                    setDigits(prev => {
                        const next = [...prev, lastDigit];

                        if (next.length > 100) {
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

    const counts = Array(10).fill(0);

    digits.forEach(value => {
        if (value >= 0 && value <= 9) {
            counts[value]++;
        }
    });

    const maxCount = Math.max(...counts);

    const mostFrequentDigit = counts.indexOf(maxCount);

    const frequency =
        digits.length > 0
            ? ((maxCount / digits.length) * 100).toFixed(1)
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
            <h2>Moniteur de tiques R75</h2>

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

            <p>
                <strong>Ticks analysés :</strong> {digits.length} / 100
            </p>

            <h3>Statistiques des chiffres</h3>

            <div>
                {counts.map((count, index) => (
                    <p key={index}>
                        <strong>{index} :</strong> {count}
                    </p>
                ))}
            </div>

            {digits.length >= 100 && (
                <div>
                    <h3>Analyse statistique</h3>

                    <p>
                        <strong>Chiffre le plus fréquent :</strong>{' '}
                        {mostFrequentDigit}
                    </p>

                    <p>
                        <strong>Occurrences :</strong> {maxCount} / 100
                    </p>

                    <p>
                        <strong>Fréquence observée :</strong> {frequency}%
                    </p>

                    <p>
                        ⚠️ Signal statistique expérimental uniquement.
                    </p>

                    <p>
                        ❌ Aucun trade automatique.
                    </p>
                </div>
            )}

            {digits.length < 100 && (
                <p>
                    📊 Collecte des données en cours...
                </p>
            )}
        </div>
    );
};

export default R75TickMonitor;

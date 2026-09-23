import React, { useEffect, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';

const R75TickMonitor = () => {
    const [status, setStatus] = useState('🟠 Connexion à Deriv…');
    const [price, setPrice] = useState('—');
    const [digit, setDigit] = useState('—');
    const [ticks, setTicks] = useState(0);

    useEffect(() => {
        let subscription: any;

        const connect = async () => {
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

                    const formattedPrice = quote.toFixed(
                        Number(tick.pip_size ?? 4)
                    );

                    const lastDigit = formattedPrice
                        .replace('.', '')
                        .slice(-1);

                    setPrice(formattedPrice);
                    setDigit(lastDigit);
                    setTicks(prev => prev + 1);
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

    return (
        <div>
            <h2>R75 Tick Monitor</h2>

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
                <strong>Ticks reçus :</strong> {ticks}
            </p>

            <p>
                ⚠️ Test uniquement — aucun trade automatique.
            </p>
        </div>
    );
};

export default R75TickMonitor;

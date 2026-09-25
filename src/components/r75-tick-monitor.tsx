import React, { useEffect, useRef, useState } from 'react';
import { api_base } from '../external/bot-skeleton';

const MARKET_SYMBOL = 'frxEURUSD';
const MARKET_NAME = 'EUR/USD';

const HISTORY_SIZE = 500;
const PAPER_TEST_LIMIT = 1000;
const BLOCK_SIZE = 100;
const ANALYSIS_WINDOW = 20;

type Direction = 'UP' | 'DOWN';

type Tick = {
    symbol?: string;
    quote?: number;
    epoch?: number;
};

type Stats = {
    tests: number;
    wins: number;
    losses: number;
    virtualProfit: number;
};

type AccountBalance = {
    balance: number | null;
    currency: string;
    loginid: string;
};

const getDirection = (
    previous: number,
    current: number
): Direction => {
    return current >= previous ? 'UP' : 'DOWN';
};

const directionLabel = (
    direction: Direction | null
) => {
    if (direction === 'UP') return '🟢 HAUSSE';
    if (direction === 'DOWN') return '🔴 BAISSE';
    return '—';
};

export default function R75TickMonitor() {
    const [connected, setConnected] =
        useState(false);

    const [connectionError, setConnectionError] =
        useState('');

    const [price, setPrice] =
        useState<number | null>(null);

    const [lastDigit, setLastDigit] =
        useState<number | null>(null);

    const [historyCount, setHistoryCount] =
        useState(0);

    const [phase, setPhase] =
        useState<'learning' | 'testing' | 'done'>(
            'learning'
        );

    const [currentDirection, setCurrentDirection] =
        useState<Direction | null>(null);

    const [prediction, setPrediction] =
        useState<Direction | null>(null);

    const [predictionStrength, setPredictionStrength] =
        useState(0);

    const [observations, setObservations] =
        useState(0);

    const [stats, setStats] = useState<Stats>({
        tests: 0,
        wins: 0,
        losses: 0,
        virtualProfit: 0,
    });

    const [blocks, setBlocks] =
        useState<number[]>([]);

    const [currentBlockWins, setCurrentBlockWins] =
        useState(0);

    const [currentBlockTests, setCurrentBlockTests] =
        useState(0);

    /*
     * =====================================================
     * COMPTE DERIV
     * =====================================================
     */

    const [accountBalance, setAccountBalance] =
        useState<AccountBalance>({
            balance: null,
            currency: '',
            loginid: '',
        });

    const [accountConnected, setAccountConnected] =
        useState(false);

    const [accountError, setAccountError] =
        useState('');

    const previousPriceRef =
        useRef<number | null>(null);

    const priceHistoryRef =
        useRef<number[]>([]);

    const directionHistoryRef =
        useRef<Direction[]>([]);

    const predictionRef =
        useRef<Direction | null>(null);

    const testsRef = useRef(0);
    const winsRef = useRef(0);
    const lossesRef = useRef(0);
    const virtualProfitRef = useRef(0);

    const blockWinsRef = useRef(0);
    const blockTestsRef = useRef(0);

    const subscribedRef =
        useRef(false);

    /*
     * =====================================================
     * ANALYSE DES DERNIERS MOUVEMENTS
     * =====================================================
     */

    const calculatePrediction = () => {
        const history =
            directionHistoryRef.current;

        const recent =
            history.slice(
                -ANALYSIS_WINDOW
            );

        if (recent.length < 5) {
            return {
                direction:
                    null as Direction | null,
                strength: 0,
                observations:
                    recent.length,
            };
        }

        let up = 0;
        let down = 0;

        recent.forEach(direction => {
            if (direction === 'UP') {
                up += 1;
            } else {
                down += 1;
            }
        });

        const total =
            up + down;

        if (total === 0) {
            return {
                direction:
                    null as Direction | null,
                strength: 0,
                observations:
                    total,
            };
        }

        const upPercent =
            (up / total) * 100;

        const downPercent =
            (down / total) * 100;

        if (up >= down) {
            return {
                direction:
                    'UP' as Direction,
                strength:
                    upPercent,
                observations:
                    total,
            };
        }

        return {
            direction:
                'DOWN' as Direction,
            strength:
                downPercent,
            observations:
                total,
        };
    };

    /*
     * =====================================================
     * TRAITEMENT TICK
     * =====================================================
     */

    const processTick = (tick: Tick) => {
        if (
            tick.symbol !==
            MARKET_SYMBOL
        ) {
            return;
        }

        if (
            typeof tick.quote !==
                'number' ||
            !Number.isFinite(
                tick.quote
            )
        ) {
            return;
        }

        const currentPrice =
            tick.quote;

        setConnected(true);
        setConnectionError('');

        setPrice(currentPrice);

        /*
         * Dernier chiffre
         */

        const priceString =
            currentPrice.toFixed(5);

        const digit =
            Number(
                priceString[
                    priceString.length - 1
                ]
            );

        setLastDigit(digit);

        /*
         * Premier tick
         */

        if (
            previousPriceRef.current ===
            null
        ) {
            previousPriceRef.current =
                currentPrice;

            priceHistoryRef.current.push(
                currentPrice
            );

            return;
        }

        const previousPrice =
            previousPriceRef.current;

        const direction =
            getDirection(
                previousPrice,
                currentPrice
            );

        previousPriceRef.current =
            currentPrice;

        /*
         * Sauvegarde du prix
         */

        priceHistoryRef.current.push(
            currentPrice
        );

        if (
            priceHistoryRef.current.length >
            HISTORY_SIZE
        ) {
            priceHistoryRef.current.shift();
        }

        /*
         * Sauvegarde du mouvement
         */

        directionHistoryRef.current.push(
            direction
        );

        if (
            directionHistoryRef.current.length >
            HISTORY_SIZE
        ) {
            directionHistoryRef.current.shift();
        }

        const historyLength =
            directionHistoryRef.current.length;

        setHistoryCount(
            Math.min(
                historyLength,
                HISTORY_SIZE
            )
        );

        setCurrentDirection(
            direction
        );

        /*
         * =================================================
         * APPRENTISSAGE
         * =================================================
         */

        if (
            historyLength <
            HISTORY_SIZE
        ) {
            setPhase('learning');

            const result =
                calculatePrediction();

            setPrediction(
                result.direction
            );

            setPredictionStrength(
                result.strength
            );

            setObservations(
                result.observations
            );

            return;
        }

        /*
         * =================================================
         * PREMIÈRE ENTRÉE EN PAPER TRADING
         * =================================================
         */

        if (
            testsRef.current === 0 &&
            predictionRef.current === null
        ) {
            setPhase('testing');

            const result =
                calculatePrediction();

            predictionRef.current =
                result.direction;

            setPrediction(
                result.direction
            );

            setPredictionStrength(
                result.strength
            );

            setObservations(
                result.observations
            );

            return;
        }

        /*
         * =================================================
         * VALIDATION DE LA PRÉDICTION PRÉCÉDENTE
         * =================================================
         */

        const previousPrediction =
            predictionRef.current;

        if (
            previousPrediction !== null &&
            testsRef.current <
                PAPER_TEST_LIMIT
        ) {
            testsRef.current += 1;

            blockTestsRef.current += 1;

            if (
                previousPrediction ===
                direction
            ) {
                winsRef.current += 1;

                blockWinsRef.current += 1;

                virtualProfitRef.current +=
                    1;
            } else {
                lossesRef.current += 1;

                virtualProfitRef.current -=
                    1;
            }

            /*
             * Bloc de 100
             */

            if (
                blockTestsRef.current ===
                BLOCK_SIZE
            ) {
                const rate =
                    (blockWinsRef.current /
                        BLOCK_SIZE) *
                    100;

                setBlocks(previous => [
                    ...previous,
                    rate,
                ]);

                blockTestsRef.current = 0;
                blockWinsRef.current = 0;
            }

            setStats({
                tests:
                    testsRef.current,
                wins:
                    winsRef.current,
                losses:
                    lossesRef.current,
                virtualProfit:
                    virtualProfitRef.current,
            });

            setCurrentBlockWins(
                blockWinsRef.current
            );

            setCurrentBlockTests(
                blockTestsRef.current
            );
        }

        /*
         * =================================================
         * FIN DU TEST
         * =================================================
         */

        if (
            testsRef.current >=
            PAPER_TEST_LIMIT
        ) {
            setPhase('done');

            /*
             * On conserve la dernière
             * prédiction visible.
             */

            const finalResult =
                calculatePrediction();

            setPrediction(
                finalResult.direction
            );

            setPredictionStrength(
                finalResult.strength
            );

            setObservations(
                finalResult.observations
            );

            predictionRef.current =
                finalResult.direction;

            return;
        }

        /*
         * =================================================
         * NOUVELLE PRÉDICTION
         * =================================================
         */

        const result =
            calculatePrediction();

        predictionRef.current =
            result.direction;

        setPrediction(
            result.direction
        );

        setPredictionStrength(
            result.strength
        );

        setObservations(
            result.observations
        );
    };

    /*
     * =====================================================
     * CONNEXION DERIV
     * =====================================================
     */

    useEffect(() => {
        let mounted = true;

        if (!api_base?.api) {
            setConnectionError(
                'api_base.api est indisponible.'
            );

            return () => {
                mounted = false;
            };
        }

        if (
            subscribedRef.current
        ) {
            return () => {
                mounted = false;
            };
        }

        subscribedRef.current = true;

        let messageSubscription:
            | {
                  unsubscribe?: () => void;
              }
            | undefined;

        try {
            messageSubscription =
                api_base.api
                    .onMessage()
                    .subscribe(
                        ({
                            data,
                        }: {
                            data: any;
                        }) => {
                            if (!mounted) {
                                return;
                            }

                            if (!data) {
                                return;
                            }

                            /*
                             * =================================================
                             * TICKS EUR/USD
                             * =================================================
                             */

                            if (
                                data.msg_type ===
                                'tick'
                            ) {
                                processTick(
                                    data.tick
                                );
                            }

                            /*
                             * =================================================
                             * SOLDE DU COMPTE
                             * =================================================
                             *
                             * Cette réponse nécessite
                             * une session Deriv authentifiée.
                             */

                            if (
                                data.msg_type ===
                                'balance'
                            ) {
                                const balanceData =
                                    data.balance;

                                if (
                                    balanceData
                                ) {
                                    const numericBalance =
                                        Number(
                                            balanceData.balance
                                        );

                                    setAccountBalance({
                                        balance:
                                            Number.isFinite(
                                                numericBalance
                                            )
                                                ? numericBalance
                                                : null,

                                        currency:
                                            String(
                                                balanceData.currency ||
                                                    ''
                                            ),

                                        loginid:
                                            String(
                                                balanceData.loginid ||
                                                    ''
                                            ),
                                    });

                                    setAccountConnected(
                                        true
                                    );

                                    setAccountError(
                                        ''
                                    );
                                }
                            }

                            /*
                             * =================================================
                             * ERREUR COMPTE
                             * =================================================
                             */

                            if (
                                data.msg_type ===
                                    'error' ||
                                data.error
                            ) {
                                const message =
                                    data.error
                                        ?.message ||
                                    data.error ||
                                    'Erreur Deriv inconnue';

                                const messageString =
                                    String(
                                        message
                                    );

                                /*
                                 * Si l'erreur concerne
                                 * le compte/balance,
                                 * on l'affiche séparément.
                                 */

                                if (
                                    messageString
                                        .toLowerCase()
                                        .includes(
                                            'author'
                                        ) ||
                                    messageString
                                        .toLowerCase()
                                        .includes(
                                            'balance'
                                        ) ||
                                    messageString
                                        .toLowerCase()
                                        .includes(
                                            'token'
                                        ) ||
                                    messageString
                                        .toLowerCase()
                                        .includes(
                                            'permission'
                                        )
                                ) {
                                    setAccountConnected(
                                        false
                                    );

                                    setAccountError(
                                        messageString
                                    );
                                } else {
                                    setConnectionError(
                                        messageString
                                    );

                                    setConnected(
                                        false
                                    );
                                }
                            }
                        }
                    );

            /*
             * =================================================
             * FLUX EUR/USD
             * =================================================
             */

            api_base.api.send({
                ticks:
                    MARKET_SYMBOL,
                subscribe: 1,
            });

            /*
             * =================================================
             * DEMANDE DU SOLDE
             * =================================================
             *
             * Aucun trade.
             * Aucun buy.
             * Aucun sell.
             */

            api_base.api.send({
                balance: 1,
                subscribe: 1,
            });

            setConnectionError('');
        } catch (error: any) {
            setConnectionError(
                error?.message ||
                    'Impossible de démarrer le flux Deriv.'
            );

            setConnected(false);
        }

        return () => {
            mounted = false;

            try {
                if (
                    messageSubscription &&
                    typeof messageSubscription.unsubscribe ===
                        'function'
                ) {
                    messageSubscription.unsubscribe();
                }
            } catch (error) {
                console.log(
                    'Erreur nettoyage abonnement EUR/USD',
                    error
                );
            }

            subscribedRef.current =
                false;
        };
    }, []);

    /*
     * =====================================================
     * CALCULS AFFICHAGE
     * =====================================================
     */

    const totalTests =
        stats.tests;

    const winRate =
        totalTests > 0
            ? (stats.wins /
                  totalTests) *
              100
            : 0;

    const lossRate =
        totalTests > 0
            ? (stats.losses /
                  totalTests) *
              100
            : 0;

    const averageBlock =
        blocks.length > 0
            ? blocks.reduce(
                  (sum, value) =>
                      sum + value,
                  0
              ) / blocks.length
            : 0;

    const minimumBlock =
        blocks.length > 0
            ? Math.min(...blocks)
            : 0;

    const maximumBlock =
        blocks.length > 0
            ? Math.max(...blocks)
            : 0;

    const displayPrice =
        price !== null
            ? price.toFixed(5)
            : '—';

    const displayBalance =
        accountBalance.balance !==
        null
            ? accountBalance.balance.toFixed(
                  2
              )
            : '—';

    /*
     * =====================================================
     * INTERFACE
     * =====================================================
     */

    return (
        <div
            style={{
                background:
                    '#111111',
                color:
                    '#ffffff',
                padding:
                    '20px',
                margin:
                    '16px',
                borderRadius:
                    '14px',
                fontFamily:
                    'Arial, sans-serif',
                lineHeight:
                    1.5,
            }}
        >
            <h2
                style={{
                    marginTop: 0,
                }}
            >
                Moniteur Forex EUR/USD —
                V4.8 Demo + Paper Trader
            </h2>

            {/* =====================================================
                CONNEXION MARCHE
               ===================================================== */}

            <div
                style={{
                    padding:
                        '14px',
                    borderRadius:
                        '12px',
                    background:
                        connected
                            ? '#064d29'
                            : '#3d3000',
                    marginBottom:
                        '16px',
                }}
            >
                <strong>
                    Connexion marché :
                </strong>{' '}

                {connected ? (
                    <>
                        🟢 Connecté à
                        Deriv —
                        EUR/USD
                    </>
                ) : (
                    <>
                        🟠 Connexion à
                        Deriv…
                    </>
                )}
            </div>

            {/* =====================================================
                COMPTE
               ===================================================== */}

            <div
                style={{
                    padding:
                        '16px',
                    borderRadius:
                        '12px',
                    background:
                        accountConnected
                            ? '#073d25'
                            : '#292929',
                    marginBottom:
                        '16px',
                    border:
                        accountConnected
                            ? '1px solid #0a7a48'
                            : '1px solid #444444',
                }}
            >
                <div
                    style={{
                        fontSize:
                            '18px',
                        fontWeight:
                            'bold',
                        marginBottom:
                            '8px',
                    }}
                >
                    💰 Compte Deriv
                </div>

                {accountConnected ? (
                    <>
                        <div>
                            <strong>
                                État :
                            </strong>{' '}
                            🟢 Compte
                            authentifié
                        </div>

                        <div
                            style={{
                                marginTop:
                                    '6px',
                            }}
                        >
                            <strong>
                                Solde :
                            </strong>{' '}
                            {displayBalance}{' '}
                            {accountBalance.currency}
                        </div>

                        {accountBalance.loginid && (
                            <div
                                style={{
                                    marginTop:
                                        '6px',
                                    fontSize:
                                        '13px',
                                    opacity:
                                        0.8,
                                }}
                            >
                                ID compte :{' '}
                                {
                                    accountBalance.loginid
                                }
                            </div>
                        )}

                        <div
                            style={{
                                marginTop:
                                    '8px',
                                color:
                                    '#8ff0bb',
                                fontSize:
                                    '13px',
                            }}
                        >
                            ℹ️ Aucun trade
                            n'est envoyé.
                        </div>
                    </>
                ) : (
                    <>
                        <div>
                            🟠 Compte non
                            authentifié
                            ou solde
                            indisponible.
                        </div>

                        <div
                            style={{
                                marginTop:
                                    '8px',
                                fontSize:
                                    '13px',
                                color:
                                    '#ffcc66',
                            }}
                        >
                            Le flux des
                            prix peut
                            fonctionner
                            sans que le
                            compte soit
                            authentifié.
                        </div>
                    </>
                )}
            </div>

            {accountError && (
                <div
                    style={{
                        background:
                            '#4b1111',
                        color:
                            '#ffb3b3',
                        padding:
                            '10px',
                        borderRadius:
                            '8px',
                        marginBottom:
                            '14px',
                    }}
                >
                    ⚠️{' '}
                    <strong>
                        Compte :
                    </strong>{' '}
                    {accountError}
                </div>
            )}

            {/* =====================================================
                ERREUR MARCHE
               ===================================================== */}

            {connectionError && (
                <div
                    style={{
                        background:
                            '#4b1111',
                        color:
                            '#ffb3b3',
                        padding:
                            '10px',
                        borderRadius:
                            '8px',
                        marginBottom:
                            '14px',
                    }}
                >
                    ⚠️{' '}
                    <strong>
                        Erreur :
                    </strong>{' '}
                    {connectionError}
                </div>
            )}

            {/* =====================================================
                MARCHE
               ===================================================== */}

            <div>
                <strong>
                    Marché :
                </strong>{' '}
                {MARKET_NAME}
            </div>

            <div>
                <strong>
                    Symbole :
                </strong>{' '}
                {MARKET_SYMBOL}
            </div>

            <div>
                <strong>
                    Prix :
                </strong>{' '}
                {displayPrice}
            </div>

            <div>
                <strong>
                    Dernier chiffre :
                </strong>{' '}
                {lastDigit !== null
                    ? lastDigit
                    : '—'}
            </div>

            <hr />

            {/* =====================================================
                PHASE 1
               ===================================================== */}

            <h3>
                Phase 1 —
                Apprentissage
            </h3>

            <div>
                <strong>
                    Historique :
                </strong>{' '}
                {historyCount} /{' '}
                {HISTORY_SIZE}
            </div>

            {historyCount <
            HISTORY_SIZE ? (
                <div>
                    ⏳ Collecte des
                    ticks en direct…
                </div>
            ) : (
                <div>
                    ✅ 500 ticks
                    collectés.
                </div>
            )}

            <h3>
                Analyse en temps réel
            </h3>

            <div>
                <strong>
                    Direction actuelle :
                </strong>{' '}
                {directionLabel(
                    currentDirection
                )}
            </div>

            <div>
                <strong>
                    Prédiction suivante :
                </strong>{' '}
                {prediction
                    ? directionLabel(
                          prediction
                      )
                    : '⏳ —'}
            </div>

            <div>
                <strong>
                    Force du signal :
                </strong>{' '}
                {prediction
                    ? `${predictionStrength.toFixed(
                          1
                      )} %`
                    : '—'}
            </div>

            <div>
                <strong>
                    Observations :
                </strong>{' '}
                {observations}
            </div>

            <div
                style={{
                    marginTop:
                        '10px',
                    padding:
                        '12px',
                    background:
                        '#222222',
                    borderRadius:
                        '10px',
                }}
            >
                🧠 Analyse basée sur
                les {ANALYSIS_WINDOW}{' '}
                derniers mouvements.
                <br />
                🔄 L'apprentissage
                continue avec les
                nouveaux ticks.
            </div>

            <hr />

            {/* =====================================================
                PHASE 2
               ===================================================== */}

            <h3>
                Phase 2 —
                Paper Trading
            </h3>

            <div>
                <strong>
                    Tests :
                </strong>{' '}
                {stats.tests} /{' '}
                {PAPER_TEST_LIMIT}
            </div>

            <div>
                🟢{' '}
                <strong>
                    Succès :
                </strong>{' '}
                {stats.wins}
            </div>

            <div>
                🔴{' '}
                <strong>
                    Échecs :
                </strong>{' '}
                {stats.losses}
            </div>

            <div>
                📊{' '}
                <strong>
                    Taux :
                </strong>{' '}
                {winRate.toFixed(2)}
                %
            </div>

            <div>
                📉{' '}
                <strong>
                    Taux d'échec :
                </strong>{' '}
                {lossRate.toFixed(2)}
                %
            </div>

            <div
                style={{
                    marginTop:
                        '14px',
                    padding:
                        '14px',
                    background:
                        '#222222',
                    borderRadius:
                        '10px',
                }}
            >
                💰{' '}
                <strong>
                    Mise virtuelle :
                </strong>{' '}
                $1.00
                <br />

                🟢{' '}
                <strong>
                    Gain virtuel :
                </strong>{' '}
                +1
                <br />

                🔴{' '}
                <strong>
                    Perte virtuelle :
                </strong>{' '}
                -1
                <br />

                🚫 Aucun argent
                réel ou démo
                n'est engagé.
            </div>

            <div
                style={{
                    marginTop:
                        '16px',
                    padding:
                        '18px',
                    borderRadius:
                        '12px',
                    background:
                        stats.virtualProfit >=
                        0
                            ? '#063f22'
                            : '#4a1010',
                }}
            >
                <div
                    style={{
                        fontSize:
                            '24px',
                        fontWeight:
                            'bold',
                    }}
                >
                    {stats.virtualProfit >=
                    0
                        ? '🟢'
                        : '🔴'}{' '}
                    Résultat virtuel :{' '}
                    {stats.virtualProfit >=
                    0
                        ? '+'
                        : ''}
                    {stats.virtualProfit}
                </div>

                <div>
                    Solde virtuel :{' '}
                    {stats.virtualProfit >=
                    0
                        ? '+'
                        : ''}
                    {stats.virtualProfit}{' '}
                    $
                </div>
            </div>

            <hr />

            {/* =====================================================
                BLOCS
               ===================================================== */}

            <h3>
                📊 Blocs de{' '}
                {BLOCK_SIZE}
            </h3>

            <div>
                <strong>
                    Blocs terminés :
                </strong>{' '}
                {blocks.length}
            </div>

            {blocks.map(
                (rate, index) => (
                    <div
                        key={index}
                    >
                        Bloc{' '}
                        {index + 1}:{' '}
                        <strong>
                            {rate.toFixed(
                                1
                            )}
                            %
                        </strong>
                    </div>
                )
            )}

            {stats.tests <
                PAPER_TEST_LIMIT &&
                currentBlockTests >
                    0 && (
                    <div
                        style={{
                            marginTop:
                                '8px',
                        }}
                    >
                        Bloc actuel :{' '}
                        {
                            currentBlockWins
                        }{' '}
                        /{' '}
                        {
                            currentBlockTests
                        }
                    </div>
                )}

            <div
                style={{
                    marginTop:
                        '10px',
                }}
            >
                <strong>
                    Moyenne :
                </strong>{' '}
                {averageBlock.toFixed(
                    2
                )}
                %
            </div>

            <div>
                <strong>
                    Minimum :
                </strong>{' '}
                {minimumBlock.toFixed(
                    2
                )}
                %
            </div>

            <div>
                <strong>
                    Maximum :
                </strong>{' '}
                {maximumBlock.toFixed(
                    2
                )}
                %
            </div>

            <hr />

            {/* =====================================================
                FIN
               ===================================================== */}

            {phase === 'done' ? (
                <div
                    style={{
                        padding:
                            '14px',
                        background:
                            '#123d24',
                        borderRadius:
                            '10px',
                    }}
                >
                    ✅{' '}
                    <strong>
                        Paper test
                        terminé.
                    </strong>

                    <br />

                    Résultat :
                    {stats.wins}{' '}
                    gains /
                    {stats.losses}{' '}
                    pertes.

                    <br />

                    Taux final :{' '}
                    {winRate.toFixed(
                        2
                    )}
                    %

                    <br />

                    Résultat virtuel :{' '}
                    {stats.virtualProfit >=
                    0
                        ? '+'
                        : ''}
                    {
                        stats.virtualProfit
                    }
                </div>
            ) : (
                <div>
                    🔬 Le système
                    fonctionne en
                    mode apprentissage
                    / paper trading.
                </div>
            )}

            <div
                style={{
                    marginTop:
                        '12px',
                    color:
                        '#ffcc66',
                }}
            >
                ⚠️ Résultat
                expérimental :
                aucun taux de
                réussite n'est
                garanti.
            </div>

            <div
                style={{
                    marginTop:
                        '8px',
                    color:
                        '#ff7777',
                }}
            >
                ❌ Aucun trade
                automatique
                réel ou démo.
            </div>
        </div>
    );
}

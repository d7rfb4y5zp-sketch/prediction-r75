import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';

import { api_base } from '../external/bot-skeleton/services/api/api-base';

const MARKET_SYMBOL = 'frxEURUSD';

const HISTORY_SIZE = 500;
const PAPER_TEST_LIMIT = 1000;
const BLOCK_SIZE = 100;
const ANALYSIS_WINDOW = 40;

const HISTORY_REQUEST_ID = 4141;
const TICK_REQUEST_ID = 4142;
const BALANCE_REQUEST_ID = 4143;

type Direction = 'UP' | 'DOWN' | 'FLAT';

type ConnectionState =
    | 'connecting'
    | 'waiting'
    | 'connected'
    | 'error';

type PaperResult = {
    total: number;
    wins: number;
    losses: number;
    pnl: number;
    lastResult: 'WIN' | 'LOSS' | '—';
    lastPnl: number;
};

type DerivMessage = {
    msg_type?: string;
    req_id?: number;

    echo_req?: {
        ticks?: string;
        ticks_history?: string;
        subscribe?: number;
        count?: number;
        end?: string;
        style?: string;
        req_id?: number;
    };

    tick?: {
        ask?: number;
        bid?: number;
        quote?: number;
        epoch?: number;
        id?: string;
        pip_size?: number;
        symbol?: string;
    };

    history?: {
        prices?: Array<number | string>;
        times?: Array<number | string>;
    };

    subscription?: {
        id?: string;
    };

    balance?: {
        balance?: number | string;
        loginid?: string;
        currency?: string;
    };

    error?: {
        code?: string;
        message?: string;
    };
};

function toFiniteNumber(
    value: unknown
): number | null {
    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : null;
}

function getDirection(
    previousPrice: number | null,
    currentPrice: number
): Direction {
    if (
        previousPrice === null ||
        !Number.isFinite(previousPrice) ||
        !Number.isFinite(currentPrice)
    ) {
        return 'FLAT';
    }

    if (currentPrice > previousPrice) {
        return 'UP';
    }

    if (currentPrice < previousPrice) {
        return 'DOWN';
    }

    return 'FLAT';
}

function getLastDigit(
    price: number,
    pipSize: number
): number {
    if (!Number.isFinite(price)) {
        return 0;
    }

    const safePipSize =
        Number.isFinite(pipSize) &&
        pipSize >= 0
            ? pipSize
            : 5;

    const fixed =
        price.toFixed(safePipSize);

    const digits =
        fixed.replace(
            /[^0-9]/g,
            ''
        );

    if (!digits.length) {
        return 0;
    }

    return Number(
        digits.charAt(
            digits.length - 1
        )
    );
}

function formatPrice(
    price: number | null,
    pipSize: number
): string {
    if (
        price === null ||
        !Number.isFinite(price)
    ) {
        return '—';
    }

    const safePipSize =
        Number.isFinite(pipSize) &&
        pipSize >= 0
            ? pipSize
            : 5;

    return price.toFixed(
        safePipSize
    );
}

function calculatePrediction(
    prices: number[]
): {
    prediction: Direction;
    strength: number;
} {
    if (prices.length < 4) {
        return {
            prediction: 'FLAT',
            strength: 0,
        };
    }

    const sample =
        prices.slice(
            Math.max(
                0,
                prices.length -
                    (ANALYSIS_WINDOW + 1)
            )
        );

    const directions: Direction[] =
        [];

    for (
        let i = 1;
        i < sample.length;
        i += 1
    ) {
        directions.push(
            getDirection(
                sample[i - 1],
                sample[i]
            )
        );
    }

    const usable =
        directions.filter(
            direction =>
                direction !== 'FLAT'
        );

    if (usable.length < 3) {
        return {
            prediction: 'FLAT',
            strength: 0,
        };
    }

    let upAfterUp = 0;
    let downAfterUp = 0;
    let upAfterDown = 0;
    let downAfterDown = 0;

    for (
        let i = 1;
        i < usable.length;
        i += 1
    ) {
        const previous =
            usable[i - 1];

        const current =
            usable[i];

        if (
            previous === 'UP' &&
            current === 'UP'
        ) {
            upAfterUp += 1;
        }

        if (
            previous === 'UP' &&
            current === 'DOWN'
        ) {
            downAfterUp += 1;
        }

        if (
            previous === 'DOWN' &&
            current === 'UP'
        ) {
            upAfterDown += 1;
        }

        if (
            previous === 'DOWN' &&
            current === 'DOWN'
        ) {
            downAfterDown += 1;
        }
    }

    const lastDirection =
        usable[usable.length - 1];

    let upScore = 0;
    let downScore = 0;

    if (lastDirection === 'UP') {
        upScore +=
            upAfterUp * 1.4;

        downScore +=
            downAfterUp * 1.4;
    }

    if (lastDirection === 'DOWN') {
        upScore +=
            upAfterDown * 1.4;

        downScore +=
            downAfterDown * 1.4;
    }

    const recent =
        usable.slice(-8);

    recent.forEach(
        (direction, index) => {
            const weight =
                index + 1;

            if (direction === 'UP') {
                upScore +=
                    weight * 0.8;
            }

            if (
                direction === 'DOWN'
            ) {
                downScore +=
                    weight * 0.8;
            }
        }
    );

    const total =
        upScore + downScore;

    if (
        total <= 0 ||
        !Number.isFinite(total)
    ) {
        return {
            prediction: 'FLAT',
            strength: 0,
        };
    }

    const difference =
        Math.abs(
            upScore - downScore
        );

    let confidence =
        (difference / total) *
        100;

    if (
        !Number.isFinite(
            confidence
        )
    ) {
        confidence = 0;
    }

    confidence = Math.max(
        0,
        Math.min(
            95,
            confidence
        )
    );

    if (confidence < 12) {
        return {
            prediction: 'FLAT',
            strength:
                Math.round(
                    confidence
                ),
        };
    }

    return {
        prediction:
            upScore > downScore
                ? 'UP'
                : 'DOWN',

        strength:
            Math.round(
                confidence
            ),
    };
}

const R75TickMonitor: React.FC =
    () => {
        const [
            connection,
            setConnection,
        ] =
            useState<ConnectionState>(
                'connecting'
            );

        const [
            connectionError,
            setConnectionError,
        ] = useState('');

        const [price, setPrice] =
            useState<
                number | null
            >(null);

        const [
            lastDigit,
            setLastDigit,
        ] = useState<
            number | null
        >(null);

        const [pipSize, setPipSize] =
            useState(5);

        const [
            direction,
            setDirection,
        ] =
            useState<Direction>(
                'FLAT'
            );

        const [
            prediction,
            setPrediction,
        ] =
            useState<Direction>(
                'FLAT'
            );

        const [
            strength,
            setStrength,
        ] = useState(0);

        const [
            tickCount,
            setTickCount,
        ] = useState(0);

        const [
            historyCount,
            setHistoryCount,
        ] = useState(0);

        const [balance, setBalance] =
            useState<
                number | null
            >(null);

        const [
            loginId,
            setLoginId,
        ] = useState('—');

        const [
            paperRunning,
            setPaperRunningState,
        ] = useState(false);

        const [
            paperResult,
            setPaperResult,
        ] =
            useState<PaperResult>({
                total: 0,
                wins: 0,
                losses: 0,
                pnl: 0,
                lastResult: '—',
                lastPnl: 0,
            });

        const [
            proposalStatus,
            setProposalStatus,
        ] = useState(
            'Aucune proposition demandée.'
        );

        /*
         * ==================================
         * REFS STABLES
         * ==================================
         *
         * Ces refs évitent que les fonctions
         * WebSocket soient recréées à chaque
         * changement d'état.
         */

        const historyRef =
            useRef<number[]>([]);

        const previousPriceRef =
            useRef<
                number | null
            >(null);

        const previousPredictionRef =
            useRef<Direction>(
                'FLAT'
            );

        const paperRunningRef =
            useRef(false);

        const paperResultRef =
            useRef<PaperResult>({
                total: 0,
                wins: 0,
                losses: 0,
                pnl: 0,
                lastResult: '—',
                lastPnl: 0,
            });

        const pipSizeRef =
            useRef(5);

        const tickCountRef =
            useRef(0);

        const subscriptionIdRef =
            useRef<
                string | null
            >(null);

        const liveRequestedRef =
            useRef(false);

        const unsubscribeRef =
            useRef<
                (() => void) | null
            >(null);

        const historyTimerRef =
            useRef<
                number | null
            >(null);

        const fallbackTimerRef =
            useRef<
                number | null
            >(null);

        const paperRunning =
            paperRunningRef.current;

        /*
         * ==================================
         * TRAITEMENT D'UN TICK
         * ==================================
         */

        const processTick =
            useCallback(
                (
                    currentPrice: number,
                    currentPipSize?: number
                ) => {
                    if (
                        !Number.isFinite(
                            currentPrice
                        )
                    ) {
                        return;
                    }

                    const safePipSize =
                        currentPipSize !==
                            undefined &&
                        Number.isFinite(
                            currentPipSize
                        )
                            ? currentPipSize
                            : pipSizeRef.current;

                    pipSizeRef.current =
                        safePipSize;

                    const previousPrice =
                        previousPriceRef.current;

                    const currentDirection =
                        getDirection(
                            previousPrice,
                            currentPrice
                        );

                    previousPriceRef.current =
                        currentPrice;

                    historyRef.current = [
                        ...historyRef.current,
                        currentPrice,
                    ].slice(
                        -HISTORY_SIZE
                    );

                    const analysis =
                        calculatePrediction(
                            historyRef.current
                        );

                    setPrice(
                        currentPrice
                    );

                    setPipSize(
                        safePipSize
                    );

                    setLastDigit(
                        getLastDigit(
                            currentPrice,
                            safePipSize
                        )
                    );

                    setDirection(
                        currentDirection
                    );

                    setPrediction(
                        analysis.prediction
                    );

                    setStrength(
                        analysis.strength
                    );

                    tickCountRef.current +=
                        1;

                    setTickCount(
                        tickCountRef.current
                    );

                    /*
                     * ==================================
                     * PAPER TEST
                     * ==================================
                     */

                    if (
                        paperRunningRef.current &&
                        previousPredictionRef.current !==
                            'FLAT' &&
                        currentDirection !==
                            'FLAT'
                    ) {
                        const predicted =
                            previousPredictionRef.current;

                        const won =
                            predicted ===
                            currentDirection;

                        const oldResult =
                            paperResultRef.current;

                        const newTotal =
                            oldResult.total +
                            1;

                        const newResult: PaperResult =
                            {
                                total:
                                    newTotal,

                                wins:
                                    oldResult.wins +
                                    (won
                                        ? 1
                                        : 0),

                                losses:
                                    oldResult.losses +
                                    (won
                                        ? 0
                                        : 1),

                                pnl:
                                    oldResult.pnl +
                                    (won
                                        ? 1
                                        : -1),

                                lastResult:
                                    won
                                        ? 'WIN'
                                        : 'LOSS',

                                lastPnl:
                                    won
                                        ? 1
                                        : -1,
                            };

                        paperResultRef.current =
                            newResult;

                        setPaperResult(
                            newResult
                        );

                        if (
                            newTotal >=
                            PAPER_TEST_LIMIT
                        ) {
                            paperRunningRef.current =
                                false;

                            setPaperRunningState(
                                false
                            );

                            setProposalStatus(
                                '🏁 Paper Test terminé : 1000 tests.'
                            );
                        }
                    }

                    /*
                     * La nouvelle prédiction
                     * devient la prédiction à
                     * valider au prochain tick.
                     */
                    if (
                        paperRunningRef.current &&
                        analysis.prediction !==
                            'FLAT'
                    ) {
                        previousPredictionRef.current =
                            analysis.prediction;
                    }
                },
                []
            );

        /*
         * ==================================
         * FLUX LIVE
         * ==================================
         */

        const startLiveStream =
            useCallback(() => {
                if (
                    !api_base.api ||
                    liveRequestedRef.current
                ) {
                    return;
                }

                try {
                    api_base.api.send({
                        ticks:
                            MARKET_SYMBOL,

                        subscribe: 1,

                        req_id:
                            TICK_REQUEST_ID,
                    });

                    liveRequestedRef.current =
                        true;

                    setConnection(
                        'waiting'
                    );
                } catch (error) {
                    console.error(
                        'Erreur abonnement EUR/USD:',
                        error
                    );

                    setConnection(
                        'error'
                    );

                    setConnectionError(
                        error instanceof
                            Error
                            ? error.message
                            : 'Impossible de démarrer le flux EUR/USD.'
                    );
                }
            }, []);

        /*
         * ==================================
         * BALANCE
         * ==================================
         */

        const requestBalance =
            useCallback(() => {
                if (
                    !api_base.api
                ) {
                    return;
                }

                try {
                    api_base.api.send(
                        {
                            balance: 1,
                            req_id:
                                BALANCE_REQUEST_ID,
                        }
                    );
                } catch (error) {
                    console.error(
                        'Erreur demande balance:',
                        error
                    );
                }
            }, []);

        /*
         * ==================================
         * HISTORIQUE
         * ==================================
         */

        const requestHistory =
            useCallback(() => {
                if (
                    !api_base.api
                ) {
                    return;
                }

                try {
                    api_base.api.send(
                        {
                            ticks_history:
                                MARKET_SYMBOL,

                            count:
                                HISTORY_SIZE,

                            end: 'latest',

                            style: 'ticks',

                            req_id:
                                HISTORY_REQUEST_ID,
                        }
                    );

                    requestBalance();

                    setConnection(
                        'waiting'
                    );
                } catch (error) {
                    console.error(
                        'Erreur historique:',
                        error
                    );

                    setConnection(
                        'error'
                    );

                    setConnectionError(
                        error instanceof
                            Error
                            ? error.message
                            : 'Impossible de charger l’historique EUR/USD.'
                    );

                    startLiveStream();
                }
            }, [
                requestBalance,
                startLiveStream,
            ]);

        /*
         * ==================================
         * MESSAGES DERIV
         * ==================================
         */

        const handleDerivMessage =
            useCallback(
                (rawMessage: unknown) => {
                    let message: DerivMessage;

                    try {
                        if (
                            typeof rawMessage ===
                            'string'
                        ) {
                            message =
                                JSON.parse(
                                    rawMessage
                                ) as DerivMessage;
                        } else {
                            message =
                                rawMessage as DerivMessage;
                        }
                    } catch (error) {
                        console.error(
                            'Message Deriv illisible:',
                            error
                        );

                        return;
                    }

                    if (
                        !message ||
                        typeof message !==
                            'object'
                    ) {
                        return;
                    }

                    const requestId =
                        message.req_id ??
                        message.echo_req
                            ?.req_id;

                    /*
                     * ==================================
                     * ERREUR DERIV
                     * ==================================
                     */

                    if (
                        message.error
                    ) {
                        const code =
                            String(
                                message.error
                                    .code ||
                                    'UNKNOWN'
                            );

                        const errorMessage =
                            String(
                                message.error
                                    .message ||
                                    'Erreur inconnue'
                            );

                        const requestedSymbol =
                            String(
                                message
                                    .echo_req
                                    ?.ticks ||
                                    message
                                        .echo_req
                                        ?.ticks_history ||
                                    ''
                            );

                        const isOurRequest =
                            requestId ===
                                HISTORY_REQUEST_ID ||
                            requestId ===
                                TICK_REQUEST_ID ||
                            requestId ===
                                BALANCE_REQUEST_ID ||
                            requestedSymbol ===
                                MARKET_SYMBOL;

                        console.error(
                            '🚨 DERIV ERROR:',
                            {
                                code,
                                errorMessage,
                                requestedSymbol,
                                requestId,
                                echo_req:
                                    message.echo_req,
                            }
                        );

                        if (
                            !isOurRequest
                        ) {
                            return;
                        }

                        /*
                         * Une erreur balance
                         * n'arrête pas EUR/USD.
                         */
                        if (
                            requestId ===
                            BALANCE_REQUEST_ID
                        ) {
                            return;
                        }

                        setConnection(
                            'error'
                        );

                        setConnectionError(
                            `Deriv ${code}: ${errorMessage}`
                        );

                        /*
                         * Si l'historique échoue,
                         * on tente le live.
                         */
                        if (
                            requestId ===
                            HISTORY_REQUEST_ID
                        ) {
                            liveRequestedRef.current =
                                false;

                            startLiveStream();
                        }

                        return;
                    }

                    /*
                     * ==================================
                     * HISTORIQUE
                     * ==================================
                     */

                    if (
                        message.msg_type ===
                            'history' ||
                        (
                            requestId ===
                                HISTORY_REQUEST_ID &&
                            message.history
                        )
                    ) {
                        const requestedSymbol =
                            String(
                                message
                                    .echo_req
                                    ?.ticks_history ||
                                    ''
                            );

                        if (
                            requestedSymbol &&
                            requestedSymbol !==
                                MARKET_SYMBOL
                        ) {
                            return;
                        }

                        const rawPrices =
                            message.history
                                ?.prices ||
                            [];

                        const prices =
                            rawPrices
                                .map(value =>
                                    Number(
                                        value
                                    )
                                )
                                .filter(
                                    value =>
                                        Number.isFinite(
                                            value
                                        )
                                );

                        if (
                            prices.length ===
                            0
                        ) {
                            setConnectionError(
                                'Historique EUR/USD reçu mais aucun prix exploitable.'
                            );

                            startLiveStream();

                            return;
                        }

                        const cleanPrices =
                            prices.slice(
                                -HISTORY_SIZE
                            );

                        historyRef.current =
                            cleanPrices;

                        setHistoryCount(
                            cleanPrices.length
                        );

                        const lastPrice =
                            cleanPrices[
                                cleanPrices.length -
                                    1
                            ];

                        const previousHistoryPrice =
                            cleanPrices.length >
                            1
                                ? cleanPrices[
                                      cleanPrices.length -
                                          2
                                  ]
                                : null;

                        const analysis =
                            calculatePrediction(
                                cleanPrices
                            );

                        const currentDirection =
                            getDirection(
                                previousHistoryPrice,
                                lastPrice
                            );

                        previousPriceRef.current =
                            lastPrice;

                        setPrice(
                            lastPrice
                        );

                        setDirection(
                            currentDirection
                        );

                        setPrediction(
                            analysis.prediction
                        );

                        setStrength(
                            analysis.strength
                        );

                        setLastDigit(
                            getLastDigit(
                                lastPrice,
                                pipSizeRef.current
                            )
                        );

                        setConnectionError(
                            ''
                        );

                        /*
                         * Maintenant seulement,
                         * on lance le flux live.
                         */
                        startLiveStream();

                        return;
                    }

                    /*
                     * ==================================
                     * BALANCE
                     * ==================================
                     */

                    if (
                        message.msg_type ===
                            'balance' &&
                        message.balance
                    ) {
                        const value =
                            Number(
                                message
                                    .balance
                                    .balance
                            );

                        if (
                            Number.isFinite(
                                value
                            )
                        ) {
                            setBalance(
                                value
                            );
                        }

                        const account =
                            message
                                .balance
                                .loginid;

                        if (
                            typeof account ===
                                'string' &&
                            account.length >
                                0
                        ) {
                            setLoginId(
                                account
                            );
                        }

                        return;
                    }

                    /*
                     * ==================================
                     * TICK LIVE
                     * ==================================
                     */

                    if (
                        message.msg_type ===
                            'tick' &&
                        message.tick
                    ) {
                        const symbol =
                            String(
                                message.tick
                                    .symbol ||
                                    ''
                            );

                        /*
                         * STRICT EUR/USD.
                         */
                        if (
                            symbol !==
                            MARKET_SYMBOL
                        ) {
                            return;
                        }

                        const quote =
                            Number(
                                message.tick
                                    .quote
                            );

                        if (
                            !Number.isFinite(
                                quote
                            )
                        ) {
                            return;
                        }

                        const incomingPipSize =
                            toFiniteNumber(
                                message.tick
                                    .pip_size
                            );

                        if (
                            incomingPipSize !==
                                null &&
                            incomingPipSize >=
                                0
                        ) {
                            pipSizeRef.current =
                                incomingPipSize;

                            setPipSize(
                                incomingPipSize
                            );
                        }

                        const subscriptionId =
                            message
                                .subscription
                                ?.id;

                        if (
                            typeof subscriptionId ===
                                'string' &&
                            subscriptionId.length >
                                0
                        ) {
                            subscriptionIdRef.current =
                                subscriptionId;
                        }

                        setConnection(
                            'connected'
                        );

                        setConnectionError(
                            ''
                        );

                        processTick(
                            quote,
                            incomingPipSize ??
                                pipSizeRef.current
                        );

                        return;
                    }
                },
                [
                    processTick,
                    startLiveStream,
                ]
            );

        /*
         * ==================================
         * INITIALISATION API
         * ==================================
         */

        const initialiseApi =
            useCallback(
                async () => {
                    try {
                        if (
                            !api_base.api
                        ) {
                            await api_base.init();
                        }

                        if (
                            !api_base.api
                        ) {
                            setConnection(
                                'error'
                            );

                            setConnectionError(
                                'API Deriv indisponible.'
                            );

                            return false;
                        }

                        return true;
                    } catch (error) {
                        console.error(
                            'Erreur initialisation API:',
                            error
                        );

                        setConnection(
                            'error'
                        );

                        setConnectionError(
                            error instanceof
                                Error
                                ? error.message
                                : 'Erreur initialisation API.'
                        );

                        return false;
                    }
                },
                []
            );

        /*
         * ==================================
         * CONNEXION
         * ==================================
         */

        useEffect(() => {
            let cancelled =
                false;

            const start =
                async () => {
                    setConnection(
                        'connecting'
                    );

                    setConnectionError(
                        ''
                    );

                    historyRef.current =
                        [];

                    previousPriceRef.current =
                        null;

                    previousPredictionRef.current =
                        'FLAT';

                    tickCountRef.current =
                        0;

                    pipSizeRef.current =
                        5;

                    liveRequestedRef.current =
                        false;

                    subscriptionIdRef.current =
                        null;

                    setTickCount(
                        0
                    );

                    setHistoryCount(
                        0
                    );

                    const ready =
                        await initialiseApi();

                    if (
                        cancelled ||
                        !ready ||
                        !api_base.api
                    ) {
                        return;
                    }

                    try {
                        /*
                         * On écoute d'abord.
                         */
                        const stream =
                            api_base.api.onMessage();

                        const subscription =
                            stream.subscribe(
                                handleDerivMessage
                            );

                        unsubscribeRef.current =
                            subscription?.unsubscribe ||
                            null;

                        /*
                         * Demande historique.
                         */
                        historyTimerRef.current =
                            window.setTimeout(
                                () => {
                                    if (
                                        !cancelled
                                    ) {
                                        requestHistory();
                                    }
                                },
                                300
                            );

                        /*
                         * Sécurité :
                         * si l'historique ne répond
                         * pas, on lance le live.
                         */
                        fallbackTimerRef.current =
                            window.setTimeout(
                                () => {
                                    if (
                                        cancelled
                                    ) {
                                        return;
                                    }

                                    if (
                                        !liveRequestedRef.current
                                    ) {
                                        startLiveStream();
                                    }
                                },
                                2000
                            );
                    } catch (error) {
                        console.error(
                            'Erreur abonnement:',
                            error
                        );

                        setConnection(
                            'error'
                        );

                        setConnectionError(
                            error instanceof
                                Error
                                ? error.message
                                : 'Erreur abonnement WebSocket.'
                        );
                    }
                };

            start();

            return () => {
                cancelled =
                    true;

                if (
                    historyTimerRef.current !==
                    null
                ) {
                    window.clearTimeout(
                        historyTimerRef.current
                    );

                    historyTimerRef.current =
                        null;
                }

                if (
                    fallbackTimerRef.current !==
                    null
                ) {
                    window.clearTimeout(
                        fallbackTimerRef.current
                    );

                    fallbackTimerRef.current =
                        null;
                }

                /*
                 * On oublie uniquement
                 * notre abonnement.
                 */
                if (
                    subscriptionIdRef.current &&
                    api_base.api
                ) {
                    try {
                        api_base.api.send(
                            {
                                forget:
                                    subscriptionIdRef.current,
                            }
                        );
                    } catch (error) {
                        console.error(
                            'Erreur forget:',
                            error
                        );
                    }

                    subscriptionIdRef.current =
                        null;
                }

                liveRequestedRef.current =
                    false;

                if (
                    unsubscribeRef.current
                ) {
                    unsubscribeRef.current();

                    unsubscribeRef.current =
                        null;
                }
            };
        }, [
            handleDerivMessage,
            initialiseApi,
            requestHistory,
            startLiveStream,
        ]);

        /*
         * ==================================
         * PAPER START
         * ==================================
         */

        const startPaperTest =
            useCallback(() => {
                const freshResult: PaperResult =
                    {
                        total: 0,
                        wins: 0,
                        losses: 0,
                        pnl: 0,
                        lastResult: '—',
                        lastPnl: 0,
                    };

                paperResultRef.current =
                    freshResult;

                setPaperResult(
                    freshResult
                );

                previousPredictionRef.current =
                    prediction;

                paperRunningRef.current =
                    true;

                setPaperRunningState(
                    true
                );

                setProposalStatus(
                    '🟢 Paper Test démarré — aucun trade réel.'
                );
            }, [prediction]);

        /*
         * ==================================
         * PAPER STOP
         * ==================================
         */

        const stopPaperTest =
            useCallback(() => {
                paperRunningRef.current =
                    false;

                setPaperRunningState(
                    false
                );

                setProposalStatus(
                    '⏹️ Paper Test arrêté — aucun trade réel.'
                );
            }, []);

        /*
         * ==================================
         * PAPER RESET
         * ==================================
         */

        const resetPaperTest =
            useCallback(() => {
                const freshResult: PaperResult =
                    {
                        total: 0,
                        wins: 0,
                        losses: 0,
                        pnl: 0,
                        lastResult: '—',
                        lastPnl: 0,
                    };

                paperRunningRef.current =
                    false;

                previousPredictionRef.current =
                    'FLAT';

                paperResultRef.current =
                    freshResult;

                setPaperRunningState(
                    false
                );

                setPaperResult(
                    freshResult
                );

                setProposalStatus(
                    '🔄 Paper Test réinitialisé.'
                );
            }, []);

        /*
         * ==================================
         * PROPOSITION UNIQUEMENT
         * ==================================
         */

        const requestDemoProposal =
            useCallback(() => {
                if (
                    prediction ===
                    'FLAT'
                ) {
                    setProposalStatus(
                        '⚪ Pas de proposition : signal STABLE.'
                    );

                    return;
                }

                setProposalStatus(
                    `🧪 Proposition démo uniquement : ${
                        prediction ===
                        'UP'
                            ? 'HAUSSE'
                            : 'BAISSE'
                    } • Force ${strength}%`
                );
            }, [
                prediction,
                strength,
            ]);

        /*
         * ==================================
         * CALCULS UI
         * ==================================
         */

        const paperRate =
            useMemo(() => {
                if (
                    paperResult.total <=
                    0
                ) {
                    return 0;
                }

                return (
                    (paperResult.wins /
                        paperResult.total) *
                    100
                );
            }, [
                paperResult.total,
                paperResult.wins,
            ]);

        const currentBlock =
            paperResult.total ===
            0
                ? 1
                : Math.min(
                      10,
                      Math.ceil(
                          paperResult.total /
                              BLOCK_SIZE
                      )
                  );

        const blockProgress =
            paperResult.total ===
            0
                ? 0
                : paperResult.total %
                      BLOCK_SIZE ===
                  0
                ? BLOCK_SIZE
                : paperResult.total %
                  BLOCK_SIZE;

        const connectionLabel =
            connection ===
            'connecting'
                ? '🟠 Connexion à Deriv…'
                : connection ===
                  'waiting'
                ? '🟡 En attente des ticks EUR/USD…'
                : connection ===
                  'connected'
                ? '🟢 Connecté — EUR/USD'
                : '🔴 Erreur EUR/USD';

        const directionLabel =
            direction ===
            'UP'
                ? '🟢 HAUSSE'
                : direction ===
                  'DOWN'
                ? '🔴 BAISSE'
                : '⚪ STABLE';

        const predictionLabel =
            prediction ===
            'UP'
                ? '🟢 HAUSSE'
                : prediction ===
                  'DOWN'
                ? '🔴 BAISSE'
                : '⚪ STABLE';

        return (
            <div
                style={{
                    width: '100%',
                    height: '100dvh',
                    minHeight: '100vh',
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    WebkitOverflowScrolling:
                        'touch',
                    overscrollBehaviorY:
                        'auto',
                    touchAction: 'pan-y',
                    background:
                        '#0f172a',
                    color:
                        '#e5e7eb',
                    padding:
                        '16px',
                    paddingBottom:
                        '70px',
                    fontFamily:
                        'Arial, sans-serif',
                    boxSizing:
                        'border-box',
                }}
            >
                <div
                    style={{
                        maxWidth:
                            '760px',
                        margin:
                            '0 auto',
                    }}
                >
                    <div
                        style={{
                            background:
                                '#111827',
                            border:
                                '1px solid #1f2937',
                            borderRadius:
                                '16px',
                            padding:
                                '18px',
                            marginBottom:
                                '14px',
                        }}
                    >
                        <h1
                            style={{
                                margin:
                                    '0 0 8px',
                                fontSize:
                                    '22px',
                                lineHeight:
                                    1.3,
                                color:
                                    '#f9fafb',
                            }}
                        >
                            📈 Moniteur Forex
                            EUR/USD — V4.14.1
                        </h1>

                        <div
                            style={{
                                fontSize:
                                    '13px',
                                color:
                                    '#9ca3af',
                                marginBottom:
                                    '14px',
                            }}
                        >
                            Demo + Paper
                            Trader +
                            Proposition
                        </div>

                        <div
                            style={{
                                padding:
                                    '12px',
                                borderRadius:
                                    '10px',
                                background:
                                    connection ===
                                    'connected'
                                        ? '#052e16'
                                        : connection ===
                                          'error'
                                        ? '#450a0a'
                                        : '#3f2f00',
                                fontWeight:
                                    700,
                                marginBottom:
                                    '10px',
                            }}
                        >
                            {connectionLabel}
                        </div>

                        {connectionError && (
                            <div
                                style={{
                                    background:
                                        '#450a0a',
                                    color:
                                        '#fecaca',
                                    border:
                                        '1px solid #7f1d1d',
                                    borderRadius:
                                        '10px',
                                    padding:
                                        '10px',
                                    marginBottom:
                                        '10px',
                                    fontSize:
                                        '13px',
                                    lineHeight:
                                        1.45,
                                    wordBreak:
                                        'break-word',
                                }}
                            >
                                <strong>
                                    Erreur exacte :
                                </strong>{' '}
                                {
                                    connectionError
                                }
                            </div>
                        )}

                        <div
                            style={{
                                fontSize:
                                    '13px',
                                color:
                                    '#94a3b8',
                            }}
                        >
                            Flux strict :{' '}
                            <strong>
                                {
                                    MARKET_SYMBOL
                                }
                            </strong>{' '}
                            •{' '}
                            {tickCount}{' '}
                            tick(s)
                            live
                            {historyCount >
                                0 && (
                                <>
                                    {' '}
                                    • historique{' '}
                                    {
                                        historyCount
                                    }
                                </>
                            )}
                        </div>
                    </div>

                    <div
                        style={{
                            display:
                                'grid',
                            gridTemplateColumns:
                                'repeat(2, minmax(0, 1fr))',
                            gap: '12px',
                            marginBottom:
                                '14px',
                        }}
                    >
                        <div
                            style={{
                                background:
                                    '#111827',
                                border:
                                    '1px solid #1f2937',
                                borderRadius:
                                    '14px',
                                padding:
                                    '16px',
                            }}
                        >
                            <div
                                style={{
                                    color:
                                        '#94a3b8',
                                    fontSize:
                                        '12px',
                                    marginBottom:
                                        '6px',
                                }}
                            >
                                Prix
                            </div>

                            <div
                                style={{
                                    fontSize:
                                        '24px',
                                    fontWeight:
                                        800,
                                    color:
                                        '#f9fafb',
                                }}
                            >
                                {formatPrice(
                                    price,
                                    pipSize
                                )}
                            </div>
                        </div>

                        <div
                            style={{
                                background:
                                    '#111827',
                                border:
                                    '1px solid #1f2937',
                                borderRadius:
                                    '14px',
                                padding:
                                    '16px',
                            }}
                        >
                            <div
                                style={{
                                    color:
                                        '#94a3b8',
                                    fontSize:
                                        '12px',
                                    marginBottom:
                                        '6px',
                                }}
                            >
                                Dernier chiffre
                            </div>

                            <div
                                style={{
                                    fontSize:
                                        '24px',
                                    fontWeight:
                                        800,
                                }}
                            >
                                {lastDigit ??
                                    '—'}
                            </div>
                        </div>
                    </div>

                    <div
                        style={{
                            background:
                                '#111827',
                            border:
                                '1px solid #1f2937',
                            borderRadius:
                                '14px',
                            padding:
                                '16px',
                            marginBottom:
                                '14px',
                        }}
                    >
                        <div
                            style={{
                                display:
                                    'flex',
                                justifyContent:
                                    'space-between',
                                marginBottom:
                                    '12px',
                                gap:
                                    '10px',
                            }}
                        >
                            <span
                                style={{
                                    color:
                                        '#94a3b8',
                                    fontSize:
                                        '13px',
                                }}
                            >
                                Direction actuelle
                            </span>

                            <strong>
                                {
                                    directionLabel
                                }
                            </strong>
                        </div>

                        <div
                            style={{
                                display:
                                    'flex',
                                justifyContent:
                                    'space-between',
                                gap:
                                    '10px',
                            }}
                        >
                            <span
                                style={{
                                    color:
                                        '#94a3b8',
                                    fontSize:
                                        '13px',
                                }}
                            >
                                Prédiction
                            </span>

                            <strong>
                                {
                                    predictionLabel
                                }
                            </strong>
                        </div>

                        <div
                            style={{
                                marginTop:
                                    '14px',
                                background:
                                    '#1f2937',
                                borderRadius:
                                    '999px',
                                height:
                                    '10px',
                                overflow:
                                    'hidden',
                            }}
                        >
                            <div
                                style={{
                                    width: `${Math.min(
                                        100,
                                        Math.max(
                                            0,
                                            strength
                                        )
                                    )}%`,
                                    height:
                                        '100%',
                                    background:
                                        prediction ===
                                        'UP'
                                            ? '#22c55e'
                                            : prediction ===
                                              'DOWN'
                                            ? '#ef4444'
                                            : '#64748b',
                                    transition:
                                        'width 0.25s ease',
                                }}
                            />
                        </div>

                        <div
                            style={{
                                marginTop:
                                    '8px',
                                textAlign:
                                    'center',
                                fontSize:
                                    '13px',
                            }}
                        >
                            Force :{' '}
                            <strong>
                                {strength}%
                            </strong>
                        </div>
                    </div>

                    <div
                        style={{
                            background:
                                '#111827',
                            border:
                                '1px solid #1f2937',
                            borderRadius:
                                '14px',
                            padding:
                                '16px',
                            marginBottom:
                                '14px',
                        }}
                    >
                        <div
                            style={{
                                fontSize:
                                    '17px',
                                fontWeight:
                                    800,
                                marginBottom:
                                    '12px',
                            }}
                        >
                            🧪 Paper Test
                        </div>

                        <div
                            style={{
                                display:
                                    'grid',
                                gridTemplateColumns:
                                    'repeat(2, minmax(0, 1fr))',
                                gap:
                                    '12px',
                            }}
                        >
                            <div>
                                <div
                                    style={{
                                        color:
                                            '#94a3b8',
                                        fontSize:
                                            '12px',
                                    }}
                                >
                                    Tests
                                </div>
                                <strong>
                                    {
                                        paperResult.total
                                    }
                                    /
                                    {
                                        PAPER_TEST_LIMIT
                                    }
                                </strong>
                            </div>

                            <div>
                                <div
                                    style={{
                                        color:
                                            '#94a3b8',
                                        fontSize:
                                            '12px',
                                    }}
                                >
                                    Taux
                                </div>
                                <strong>
                                    {paperRate.toFixed(
                                        2
                                    )}
                                    %
                                </strong>
                            </div>

                            <div>
                                <div
                                    style={{
                                        color:
                                            '#94a3b8',
                                        fontSize:
                                            '12px',
                                    }}
                                >
                                    Wins
                                </div>
                                <strong
                                    style={{
                                        color:
                                            '#4ade80',
                                    }}
                                >
                                    {
                                        paperResult.wins
                                    }
                                </strong>
                            </div>

                            <div>
                                <div
                                    style={{
                                        color:
                                            '#94a3b8',
                                        fontSize:
                                            '12px',
                                    }}
                                >
                                    Losses
                                </div>
                                <strong
                                    style={{
                                        color:
                                            '#f87171',
                                    }}
                                >
                                    {
                                        paperResult.losses
                                    }
                                </strong>
                            </div>

                            <div>
                                <div
                                    style={{
                                        color:
                                            '#94a3b8',
                                        fontSize:
                                            '12px',
                                    }}
                                >
                                    P/L virtuel
                                </div>
                                <strong
                                    style={{
                                        color:
                                            paperResult.pnl >=
                                            0
                                                ? '#4ade80'
                                                : '#f87171',
                                    }}
                                >
                                    {paperResult.pnl >=
                                    0
                                        ? '+'
                                        : ''}
                                    {
                                        paperResult.pnl
                                    }
                                </strong>
                            </div>

                            <div>
                                <div
                                    style={{
                                        color:
                                            '#94a3b8',
                                        fontSize:
                                            '12px',
                                    }}
                                >
                                    Dernier
                                </div>
                                <strong>
                                    {paperResult.lastResult ===
                                    'WIN'
                                        ? '🟢 WIN +1'
                                        : paperResult.lastResult ===
                                          'LOSS'
                                        ? '🔴 LOSS -1'
                                        : '—'}
                                </strong>
                            </div>
                        </div>

                        <div
                            style={{
                                marginTop:
                                    '14px',
                                color:
                                    '#cbd5e1',
                                fontSize:
                                    '13px',
                            }}
                        >
                            Bloc{' '}
                            {currentBlock}
                            /10 •{' '}
                            {blockProgress}
                            /100
                        </div>

                        <div
                            style={{
                                display:
                                    'flex',
                                flexWrap:
                                    'wrap',
                                gap:
                                    '8px',
                                marginTop:
                                    '14px',
                            }}
                        >
                            {!paperRunning ? (
                                <button
                                    type="button"
                                    onClick={
                                        startPaperTest
                                    }
                                    disabled={
                                        paperResult.total >=
                                        PAPER_TEST_LIMIT
                                    }
                                    style={{
                                        border:
                                            'none',
                                        borderRadius:
                                            '10px',
                                        padding:
                                            '11px 14px',
                                        background:
                                            '#16a34a',
                                        color:
                                            '#fff',
                                        fontWeight:
                                            800,
                                    }}
                                >
                                    ▶️ Démarrer
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={
                                        stopPaperTest
                                    }
                                    style={{
                                        border:
                                            'none',
                                        borderRadius:
                                            '10px',
                                        padding:
                                            '11px 14px',
                                        background:
                                            '#dc2626',
                                        color:
                                            '#fff',
                                        fontWeight:
                                            800,
                                    }}
                                >
                                    ⏹️ Arrêter
                                </button>
                            )}

                            <button
                                type="button"
                                onClick={
                                    resetPaperTest
                                }
                                style={{
                                    border:
                                        '1px solid #374151',
                                    borderRadius:
                                        '10px',
                                    padding:
                                        '11px 14px',
                                    background:
                                        '#1f2937',
                                    color:
                                        '#e5e7eb',
                                    fontWeight:
                                        700,
                                }}
                            >
                                🔄 Reset
                            </button>
                        </div>

                        <div
                            style={{
                                marginTop:
                                    '12px',
                                fontSize:
                                    '12px',
                                color:
                                    '#94a3b8',
                                lineHeight:
                                    1.5,
                            }}
                        >
                            Validation de la
                            prédiction précédente
                            sur le tick suivant.
                            P/L virtuel uniquement :
                            +1 / -1.
                        </div>
                    </div>

                    <div
                        style={{
                            background:
                                '#111827',
                            border:
                                '1px solid #1f2937',
                            borderRadius:
                                '14px',
                            padding:
                                '16px',
                            marginBottom:
                                '14px',
                        }}
                    >
                        <div
                            style={{
                                fontSize:
                                    '17px',
                                fontWeight:
                                    800,
                                marginBottom:
                                    '10px',
                            }}
                        >
                            💰 Compte démo
                        </div>

                        <div
                            style={{
                                display:
                                    'grid',
                                gridTemplateColumns:
                                    'repeat(2, minmax(0, 1fr))',
                                gap:
                                    '12px',
                            }}
                        >
                            <div>
                                <div
                                    style={{
                                        color:
                                            '#94a3b8',
                                        fontSize:
                                            '12px',
                                    }}
                                >
                                    Balance
                                </div>

                                <strong>
                                    {balance !==
                                    null
                                        ? `${balance.toFixed(
                                              2
                                          )} USD`
                                        : '—'}
                                </strong>
                            </div>

                            <div>
                                <div
                                    style={{
                                        color:
                                            '#94a3b8',
                                        fontSize:
                                            '12px',
                                    }}
                                >
                                    Account
                                </div>

                                <strong
                                    style={{
                                        wordBreak:
                                            'break-word',
                                    }}
                                >
                                    {
                                        loginId
                                    }
                                </strong>
                            </div>
                        </div>
                    </div>

                    <div
                        style={{
                            background:
                                '#111827',
                            border:
                                '1px solid #1f2937',
                            borderRadius:
                                '14px',
                            padding:
                                '16px',
                            marginBottom:
                                '14px',
                        }}
                    >
                        <div
                            style={{
                                fontSize:
                                    '17px',
                                fontWeight:
                                    800,
                                marginBottom:
                                    '10px',
                            }}
                        >
                            🧪 Proposition démo
                        </div>

                        <div
                            style={{
                                background:
                                    '#0f172a',
                                borderRadius:
                                    '10px',
                                padding:
                                    '12px',
                                marginBottom:
                                    '12px',
                                fontSize:
                                    '13px',
                                lineHeight:
                                    1.5,
                            }}
                        >
                            {
                                proposalStatus
                            }
                        </div>

                        <button
                            type="button"
                            onClick={
                                requestDemoProposal
                            }
                            disabled={
                                prediction ===
                                'FLAT'
                            }
                            style={{
                                width:
                                    '100%',
                                border:
                                    'none',
                                borderRadius:
                                    '10px',
                                padding:
                                    '12px',
                                background:
                                    prediction ===
                                    'UP'
                                        ? '#16a34a'
                                        : prediction ===
                                          'DOWN'
                                        ? '#dc2626'
                                        : '#475569',
                                color:
                                    '#fff',
                                fontWeight:
                                    800,
                                opacity:
                                    prediction ===
                                    'FLAT'
                                        ? 0.6
                                        : 1,
                            }}
                        >
                            📋 Demander une
                            proposition démo
                        </button>

                        <div
                            style={{
                                marginTop:
                                    '12px',
                                padding:
                                    '10px',
                                borderRadius:
                                    '10px',
                                background:
                                    '#422006',
                                color:
                                    '#fed7aa',
                                fontSize:
                                    '12px',
                                lineHeight:
                                    1.5,
                            }}
                        >
                            ⚠️ Proposition et
                            analyse uniquement.
                            Aucun ordre réel
                            n'est envoyé par ce
                            composant.
                        </div>
                    </div>

                    <div
                        style={{
                            background:
                                '#111827',
                            border:
                                '1px solid #1f2937',
                            borderRadius:
                                '14px',
                            padding:
                                '16px',
                            marginBottom:
                                '14px',
                        }}
                    >
                        <div
                            style={{
                                fontSize:
                                    '17px',
                                fontWeight:
                                    800,
                                marginBottom:
                                    '10px',
                            }}
                        >
                            🔎 État du moteur
                        </div>

                        <div
                            style={{
                                display:
                                    'grid',
                                gap:
                                    '8px',
                                fontSize:
                                    '13px',
                                color:
                                    '#cbd5e1',
                            }}
                        >
                            <div>
                                Marché :{' '}
                                <strong>
                                    {
                                        MARKET_SYMBOL
                                    }
                                </strong>
                            </div>

                            <div>
                                Historique :{' '}
                                <strong>
                                    {
                                        historyCount
                                    }
                                </strong>
                                {' '}ticks
                            </div>

                            <div>
                                Live :{' '}
                                <strong>
                                    {
                                        tickCount
                                    }
                                </strong>
                                {' '}ticks
                            </div>

                            <div>
                                Direction :{' '}
                                <strong>
                                    {
                                        directionLabel
                                    }
                                </strong>
                            </div>

                            <div>
                                Signal :{' '}
                                <strong>
                                    {
                                        predictionLabel
                                    }
                                </strong>
                            </div>

                            <div>
                                Force :{' '}
                                <strong>
                                    {strength}%
                                </strong>
                            </div>

                            <div>
                                Mode :{' '}
                                <strong>
                                    {paperRunning
                                        ? 'PAPER EN COURS'
                                        : 'PAPER ARRÊTÉ'}
                                </strong>
                            </div>
                        </div>
                    </div>

                    <div
                        style={{
                            textAlign:
                                'center',
                            color:
                                '#64748b',
                            fontSize:
                                '11px',
                            lineHeight:
                                1.5,
                            padding:
                                '8px 4px 20px',
                        }}
                    >
                        V4.14.1 • EUR/USD
                        strict • historique
                        500 ticks • Paper Test
                        uniquement
                    </div>
                </div>
            </div>
        );
    };

export default R75TickMonitor;

import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';

const MARKET_SYMBOL = 'frxEURUSD';
const MARKET_NAME = 'EUR/USD';

const HISTORY_SIZE = 500;
const PAPER_TEST_LIMIT = 1000;
const BLOCK_SIZE = 100;

/*
 * Fenêtre utilisée par le moteur.
 *
 * On analyse suffisamment de directions pour
 * éviter de réagir uniquement au dernier tick.
 */
const ANALYSIS_WINDOW = 30;

const TICK_REQUEST_ID = 4111;
const HISTORY_REQUEST_ID = 4114;
const BALANCE_REQUEST_ID = 4113;

type Direction = 'UP' | 'DOWN' | 'FLAT';

type PaperResult = {
    total: number;
    wins: number;
    losses: number;
    pnl: number;
};

type TickData = {
    symbol?: string;
    quote?: number | string;
    epoch?: number;
    pip_size?: number;
};

type PredictionAnalysis = {
    prediction: Direction;
    strength: number;
    upScore: number;
    downScore: number;
    transitionScore: number;
    momentumScore: number;
    continuationScore: number;
    sampleSize: number;
};

/* =========================================================
   UTILITAIRES
========================================================= */

const getQuote = (
    tick: TickData
): number | null => {
    const quote = Number(
        tick?.quote
    );

    return Number.isFinite(
        quote
    )
        ? quote
        : null;
};

const getLastDigit = (
    quote: number,
    pipSize?: number
): string => {
    /*
     * EUR/USD utilise normalement 5 décimales.
     * Si Deriv fournit pip_size, on l'utilise.
     */
    const digits =
        Number.isFinite(
            Number(pipSize)
        ) &&
        Number(pipSize) >= 0
            ? Number(pipSize)
            : 5;

    const fixed =
        quote.toFixed(digits);

    const clean =
        fixed.replace('.', '');

    if (
        clean.length === 0
    ) {
        return '—';
    }

    return clean[
        clean.length - 1
    ];
};

const getDirection = (
    previous: number | null,
    current: number
): Direction => {
    if (
        previous === null
    ) {
        return 'FLAT';
    }

    if (
        current > previous
    ) {
        return 'UP';
    }

    if (
        current < previous
    ) {
        return 'DOWN';
    }

    return 'FLAT';
};

/* =========================================================
   MOTEUR V4.11.5
========================================================= */

const calculatePrediction = (
    directions: Direction[]
): PredictionAnalysis => {
    const usable =
        directions
            .filter(
                direction =>
                    direction ===
                        'UP' ||
                    direction ===
                        'DOWN'
            )
            .slice(
                -ANALYSIS_WINDOW
            );

    if (
        usable.length < 6
    ) {
        return {
            prediction: 'FLAT',
            strength: 0,
            upScore: 0,
            downScore: 0,
            transitionScore: 0,
            momentumScore: 0,
            continuationScore: 0,
            sampleSize:
                usable.length,
        };
    }

    /*
     * -----------------------------------------------------
     * 1. TRANSITION MATRIX
     *
     * Exemple :
     * UP -> UP
     * UP -> DOWN
     * DOWN -> UP
     * DOWN -> DOWN
     * -----------------------------------------------------
     */

    let upAfterUp = 0;
    let downAfterUp = 0;
    let upAfterDown = 0;
    let downAfterDown = 0;

    for (
        let i = 1;
        i < usable.length;
        i++
    ) {
        const previous =
            usable[i - 1];

        const current =
            usable[i];

        if (
            previous === 'UP'
        ) {
            if (
                current === 'UP'
            ) {
                upAfterUp++;
            } else {
                downAfterUp++;
            }
        }

        if (
            previous === 'DOWN'
        ) {
            if (
                current === 'UP'
            ) {
                upAfterDown++;
            } else {
                downAfterDown++;
            }
        }
    }

    const lastDirection =
        usable[
            usable.length - 1
        ];

    /*
     * Probabilité empirique de la prochaine direction
     * conditionnelle à la dernière direction.
     */
    let transitionUp = 0;
    let transitionDown = 0;

    if (
        lastDirection === 'UP'
    ) {
        const total =
            upAfterUp +
            downAfterUp;

        if (total > 0) {
            transitionUp =
                upAfterUp /
                total;

            transitionDown =
                downAfterUp /
                total;
        }
    }

    if (
        lastDirection === 'DOWN'
    ) {
        const total =
            upAfterDown +
            downAfterDown;

        if (total > 0) {
            transitionUp =
                upAfterDown /
                total;

            transitionDown =
                downAfterDown /
                total;
        }
    }

    /*
     * -----------------------------------------------------
     * 2. MOMENTUM RÉCENT
     *
     * Les derniers mouvements ont plus de poids.
     * -----------------------------------------------------
     */

    let momentumUp = 0;
    let momentumDown = 0;

    usable.forEach(
        (
            direction,
            index
        ) => {
            const weight =
                index + 1;

            if (
                direction === 'UP'
            ) {
                momentumUp +=
                    weight;
            } else {
                momentumDown +=
                    weight;
            }
        }
    );

    const momentumTotal =
        momentumUp +
        momentumDown;

    /*
     * -----------------------------------------------------
     * 3. CONTINUATION / RETOURNEMENT
     *
     * On regarde la série récente.
     * -----------------------------------------------------
     */

    const recent =
        usable.slice(-8);

    let recentUp = 0;
    let recentDown = 0;

    recent.forEach(
        direction => {
            if (
                direction === 'UP'
            ) {
                recentUp++;
            } else {
                recentDown++;
            }
        }
    );

    const recentTotal =
        recentUp +
        recentDown;

    let continuationUp = 0;
    let continuationDown = 0;

    if (
        recentTotal > 0
    ) {
        continuationUp =
            recentUp /
            recentTotal;

        continuationDown =
            recentDown /
            recentTotal;
    }

    /*
     * -----------------------------------------------------
     * 4. SCORE FINAL
     *
     * Transition : poids important
     * Momentum   : poids moyen
     * Récent     : poids complémentaire
     * -----------------------------------------------------
     */

    const transitionWeight = 0.45;
    const momentumWeight = 0.35;
    const recentWeight = 0.20;

    const transitionScoreUp =
        transitionUp *
        transitionWeight;

    const transitionScoreDown =
        transitionDown *
        transitionWeight;

    const normalizedMomentumUp =
        momentumTotal > 0
            ? momentumUp /
              momentumTotal
            : 0;

    const normalizedMomentumDown =
        momentumTotal > 0
            ? momentumDown /
              momentumTotal
            : 0;

    const momentumScoreUp =
        normalizedMomentumUp *
        momentumWeight;

    const momentumScoreDown =
        normalizedMomentumDown *
        momentumWeight;

    const continuationScoreUp =
        continuationUp *
        recentWeight;

    const continuationScoreDown =
        continuationDown *
        recentWeight;

    const upScore =
        transitionScoreUp +
        momentumScoreUp +
        continuationScoreUp;

    const downScore =
        transitionScoreDown +
        momentumScoreDown +
        continuationScoreDown;

    const totalScore =
        upScore +
        downScore;

    if (
        totalScore <= 0
    ) {
        return {
            prediction: 'FLAT',
            strength: 0,
            upScore,
            downScore,
            transitionScore:
                0,
            momentumScore:
                0,
            continuationScore:
                0,
            sampleSize:
                usable.length,
        };
    }

    const difference =
        Math.abs(
            upScore -
                downScore
        );

    let strength =
        (difference /
            totalScore) *
        100;

    /*
     * Évite de donner une forte prédiction
     * avec un échantillon trop petit.
     */
    if (
        usable.length < 10
    ) {
        strength *= 0.65;
    }

    strength = Math.min(
        95,
        strength
    );

    /*
     * Zone neutre :
     * si les scores sont trop proches,
     * on préfère STABLE.
     */
    if (
        strength < 12
    ) {
        return {
            prediction: 'FLAT',
            strength,
            upScore,
            downScore,
            transitionScore:
                Math.abs(
                    transitionUp -
                        transitionDown
                ) * 100,
            momentumScore:
                Math.abs(
                    normalizedMomentumUp -
                        normalizedMomentumDown
                ) * 100,
            continuationScore:
                Math.abs(
                    continuationUp -
                        continuationDown
                ) * 100,
            sampleSize:
                usable.length,
        };
    }

    const prediction =
        upScore >
        downScore
            ? 'UP'
            : 'DOWN';

    return {
        prediction,
        strength,
        upScore,
        downScore,
        transitionScore:
            Math.abs(
                transitionUp -
                    transitionDown
            ) * 100,
        momentumScore:
            Math.abs(
                normalizedMomentumUp -
                    normalizedMomentumDown
            ) * 100,
        continuationScore:
            Math.abs(
                continuationUp -
                    continuationDown
            ) * 100,
        sampleSize:
            usable.length,
    };
};

/* =========================================================
   COMPOSANT
========================================================= */

const R75TickMonitor =
    observer(() => {
        const [
            connection,
            setConnection,
        ] = useState<
            | 'connecting'
            | 'connected'
            | 'waiting'
            | 'closed'
            | 'error'
        >('connecting');

        const [
            price,
            setPrice,
        ] = useState<
            number | null
        >(null);

        const [
            lastDigit,
            setLastDigit,
        ] = useState('—');

        const [
            currentDirection,
            setCurrentDirection,
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
            predictionStrength,
            setPredictionStrength,
        ] = useState(0);

        const [
            observations,
            setObservations,
        ] = useState(0);

        const [
            historyCount,
            setHistoryCount,
        ] = useState(0);

        const [
            balance,
            setBalance,
        ] =
            useState<
                number | null
            >(null);

        const [
            loginId,
            setLoginId,
        ] = useState('—');

        const [
            paperRunning,
            setPaperRunning,
        ] = useState(false);

        const [
            paperResult,
            setPaperResult,
        ] =
            useState<PaperResult>(
                {
                    total: 0,
                    wins: 0,
                    losses: 0,
                    pnl: 0,
                }
            );

        const [
            proposalStatus,
            setProposalStatus,
        ] = useState(
            '⏳ Initialisation…'
        );

        const [
            marketMessage,
            setMarketMessage,
        ] = useState('');

        /*
         * Statistiques supplémentaires
         */
        const [
            lastResult,
            setLastResult,
        ] = useState<
            'WIN' |
            'LOSS' |
            '—'
        >('—');

        const [
            currentStreak,
            setCurrentStreak,
        ] = useState(0);

        const [
            streakType,
            setStreakType,
        ] = useState<
            'WIN' |
            'LOSS' |
            '—'
        >('—');

        const [
            blockWins,
            setBlockWins,
        ] = useState(0);

        const [
            blockLosses,
            setBlockLosses,
        ] = useState(0);

        const [
            engineInfo,
            setEngineInfo,
        ] = useState(
            '⏳ En attente des données'
        );

        const pricesRef =
            useRef<number[]>(
                []
            );

        const directionsRef =
            useRef<Direction[]>(
                []
            );

        const previousPriceRef =
            useRef<number | null>(
                null
            );

        const previousPredictionRef =
            useRef<Direction>(
                'FLAT'
            );

        const paperRunningRef =
            useRef(false);

        const paperResultRef =
            useRef<PaperResult>(
                {
                    total: 0,
                    wins: 0,
                    losses: 0,
                    pnl: 0,
                }
            );

        const streakRef =
            useRef<{
                type:
                    | 'WIN'
                    | 'LOSS'
                    | '—';
                count: number;
            }>({
                type: '—',
                count: 0,
            });

        const unsubscribeRef =
            useRef<
                (() => void) | null
            >(null);

        const mountedRef =
            useRef(true);

        /* =================================================
           BALANCE
        ================================================= */

        const processBalance =
            useCallback(
                (message: any) => {
                    const rawBalance =
                        Number(
                            message
                                ?.balance
                                ?.balance
                        );

                    if (
                        Number.isFinite(
                            rawBalance
                        )
                    ) {
                        setBalance(
                            rawBalance
                        );
                    }

                    const account =
                        message
                            ?.balance
                            ?.loginid;

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
                },
                []
            );

        /* =================================================
           VALIDATION PAPER
        ================================================= */

        const validatePreviousPrediction =
            useCallback(
                (
                    newDirection: Direction
                ) => {
                    if (
                        !paperRunningRef.current
                    ) {
                        return;
                    }

                    const predicted =
                        previousPredictionRef.current;

                    if (
                        predicted !==
                            'UP' &&
                        predicted !==
                            'DOWN'
                    ) {
                        return;
                    }

                    if (
                        newDirection !==
                            'UP' &&
                        newDirection !==
                            'DOWN'
                    ) {
                        return;
                    }

                    const previous =
                        paperResultRef.current;

                    const isWin =
                        predicted ===
                        newDirection;

                    const next: PaperResult =
                        {
                            total:
                                previous.total +
                                1,

                            wins:
                                previous.wins +
                                (isWin
                                    ? 1
                                    : 0),

                            losses:
                                previous.losses +
                                (isWin
                                    ? 0
                                    : 1),

                            pnl:
                                previous.pnl +
                                (isWin
                                    ? 1
                                    : -1),
                        };

                    paperResultRef.current =
                        next;

                    setPaperResult(
                        next
                    );

                    const resultType =
                        isWin
                            ? 'WIN'
                            : 'LOSS';

                    setLastResult(
                        resultType
                    );

                    /*
                     * Série actuelle
                     */
                    if (
                        streakRef.current
                            .type ===
                        resultType
                    ) {
                        streakRef.current.count++;
                    } else {
                        streakRef.current =
                            {
                                type:
                                    resultType,
                                count: 1,
                            };
                    }

                    setStreakType(
                        streakRef.current
                            .type
                    );

                    setCurrentStreak(
                        streakRef.current
                            .count
                    );

                    /*
                     * Statistiques du bloc
                     */
                    const blockStart =
                        Math.floor(
                            (next.total -
                                1) /
                                BLOCK_SIZE
                        ) *
                            BLOCK_SIZE;

                    const position =
                        next.total -
                        blockStart;

                    if (
                        position ===
                        1
                    ) {
                        setBlockWins(
                            isWin
                                ? 1
                                : 0
                        );

                        setBlockLosses(
                            isWin
                                ? 0
                                : 1
                        );
                    } else {
                        setBlockWins(
                            current =>
                                current +
                                (isWin
                                    ? 1
                                    : 0)
                        );

                        setBlockLosses(
                            current =>
                                current +
                                (isWin
                                    ? 0
                                    : 1)
                        );
                    }

                    if (
                        next.total >=
                        PAPER_TEST_LIMIT
                    ) {
                        paperRunningRef.current =
                            false;

                        setPaperRunning(
                            false
                        );

                        setProposalStatus(
                            '🏁 Paper Test terminé — 1000/1000'
                        );
                    }
                },
                []
            );

        /* =================================================
           TICK
        ================================================= */

        const processTick =
            useCallback(
                (tick: TickData) => {
                    if (!tick) {
                        return;
                    }

                    const symbol =
                        String(
                            tick.symbol ||
                                ''
                        );

                    /*
                     * FILTRE STRICT
                     */
                    if (
                        symbol !==
                        MARKET_SYMBOL
                    ) {
                        return;
                    }

                    const quote =
                        getQuote(tick);

                    if (
                        quote === null
                    ) {
                        return;
                    }

                    const direction =
                        getDirection(
                            previousPriceRef.current,
                            quote
                        );

                    /*
                     * Validation du signal
                     * précédent sur ce nouveau tick.
                     */
                    if (
                        previousPriceRef.current !==
                        null
                    ) {
                        validatePreviousPrediction(
                            direction
                        );
                    }

                    previousPriceRef.current =
                        quote;

                    pricesRef.current =
                        [
                            ...pricesRef.current,
                            quote,
                        ].slice(
                            -HISTORY_SIZE
                        );

                    directionsRef.current =
                        [
                            ...directionsRef.current,
                            direction,
                        ].slice(
                            -HISTORY_SIZE
                        );

                    setPrice(
                        quote
                    );

                    setLastDigit(
                        getLastDigit(
                            quote,
                            tick.pip_size
                        )
                    );

                    setCurrentDirection(
                        direction
                    );

                    setHistoryCount(
                        pricesRef.current
                            .length
                    );

                    setObservations(
                        directionsRef.current
                            .length
                    );

                    /*
                     * NOUVEAU MOTEUR
                     */
                    const analysis =
                        calculatePrediction(
                            directionsRef.current
                        );

                    setPrediction(
                        analysis.prediction
                    );

                    setPredictionStrength(
                        analysis.strength
                    );

                    /*
                     * Information moteur
                     */
                    if (
                        analysis.prediction ===
                        'UP'
                    ) {
                        setEngineInfo(
                            `🟢 UP ${analysis.strength.toFixed(
                                1
                            )}% • échantillon ${analysis.sampleSize}`
                        );
                    } else if (
                        analysis.prediction ===
                        'DOWN'
                    ) {
                        setEngineInfo(
                            `🔴 DOWN ${analysis.strength.toFixed(
                                1
                            )}% • échantillon ${analysis.sampleSize}`
                        );
                    } else {
                        setEngineInfo(
                            `⚪ STABLE ${analysis.strength.toFixed(
                                1
                            )}% • échantillon ${analysis.sampleSize}`
                        );
                    }

                    /*
                     * Le signal actuel sera
                     * validé sur le tick suivant.
                     */
                    previousPredictionRef.current =
                        analysis.prediction;

                    if (
                        mountedRef.current
                    ) {
                        setConnection(
                            'connected'
                        );

                        setMarketMessage(
                            ''
                        );

                        if (
                            !paperRunningRef.current
                        ) {
                            setProposalStatus(
                                '🟢 EUR/USD en direct — prêt pour le Paper Test'
                            );
                        }
                    }
                },
                [
                    validatePreviousPrediction,
                ]
            );

        /* =================================================
           MESSAGE DERIV
        ================================================= */

        const handleDerivMessage =
            useCallback(
                (payload: any) => {
                    const message =
                        payload?.data ??
                        payload;

                    if (!message) {
                        return;
                    }

                    /*
                     * ERREUR DERIV
                     */
                    if (
                        message.error
                    ) {
                        const errorCode =
                            String(
                                message
                                    .error
                                    ?.code ||
                                    'UNKNOWN'
                            );

                        const errorMessage =
                            String(
                                message
                                    .error
                                    ?.message ||
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

                        console.error(
                            '🚨 ERREUR DERIV:',
                            message
                        );

                        /*
                         * Marché fermé :
                         * état normal pendant
                         * le week-end.
                         */
                        if (
                            errorCode ===
                            'MarketIsClosed'
                        ) {
                            if (
                                mountedRef.current
                            ) {
                                setConnection(
                                    'closed'
                                );

                                setMarketMessage(
                                    errorMessage
                                );

                                setProposalStatus(
                                    `🟠 Marché ${MARKET_NAME} fermé`
                                );
                            }

                            return;
                        }

                        /*
                         * Erreur concernant
                         * EUR/USD.
                         */
                        if (
                            requestedSymbol ===
                            MARKET_SYMBOL
                        ) {
                            if (
                                mountedRef.current
                            ) {
                                setConnection(
                                    'error'
                                );

                                setProposalStatus(
                                    `🔴 Deriv ${errorCode}: ${errorMessage}`
                                );
                            }
                        }

                        return;
                    }

                    /*
                     * BALANCE
                     */
                    if (
                        message.msg_type ===
                        'balance'
                    ) {
                        processBalance(
                            message
                        );

                        return;
                    }

                    /*
                     * HISTORIQUE
                     *
                     * L'historique est traité
                     * dans la réponse de send().
                     */
                    if (
                        message.msg_type ===
                        'ticks_history'
                    ) {
                        return;
                    }

                    /*
                     * TICK LIVE
                     */
                    if (
                        message.msg_type ===
                            'tick' &&
                        message.tick
                    ) {
                        const symbol =
                            String(
                                message
                                    .tick
                                    .symbol ||
                                    ''
                            );

                        if (
                            symbol !==
                            MARKET_SYMBOL
                        ) {
                            return;
                        }

                        processTick(
                            message.tick
                        );
                    }
                },
                [
                    processBalance,
                    processTick,
                ]
            );

        /* =================================================
           BALANCE REQUEST
        ================================================= */

        const requestBalance =
            useCallback(() => {
                if (
                    !api_base?.api
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

        /* =================================================
           INITIALISATION API
        ================================================= */

        const initialiseApi =
            useCallback(
                async () => {
                    try {
                        if (
                            !api_base?.api
                        ) {
                            await api_base.init();
                        }

                        if (
                            !api_base?.api
                        ) {
                            throw new Error(
                                'api_base.api indisponible après initialisation.'
                            );
                        }

                        return true;
                    } catch (
                        error
                    ) {
                        console.error(
                            '❌ Erreur initialisation API:',
                            error
                        );

                        if (
                            mountedRef.current
                        ) {
                            setConnection(
                                'error'
                            );

                            setProposalStatus(
                                `🔴 Initialisation Deriv impossible : ${
                                    error instanceof
                                    Error
                                        ? error.message
                                        : 'erreur inconnue'
                                }`
                            );
                        }

                        return false;
                    }
                },
                []
            );

        /* =================================================
           CONNEXION
        ================================================= */

        useEffect(() => {
            mountedRef.current =
                true;

            let cancelled =
                false;

            const startConnection =
                async () => {
                    setConnection(
                        'connecting'
                    );

                    setMarketMessage(
                        ''
                    );

                    setProposalStatus(
                        '⏳ Connexion à Deriv…'
                    );

                    const ready =
                        await initialiseApi();

                    if (
                        cancelled ||
                        !ready ||
                        !api_base?.api
                    ) {
                        return;
                    }

                    try {
                        /*
                         * MESSAGE STREAM
                         */
                        const messageStream =
                            api_base.api.onMessage();

                        const subscription =
                            messageStream.subscribe(
                                handleDerivMessage
                            );

                        unsubscribeRef.current =
                            subscription?.unsubscribe ||
                            null;

                        /*
                         * =================================
                         * HISTORIQUE
                         * =================================
                         *
                         * IMPORTANT :
                         * Dans ton API actuelle,
                         * subscribe doit être 1.
                         */
                        try {
                            setProposalStatus(
                                '📚 Chargement de 500 ticks EUR/USD…'
                            );

                            const historyResponse =
                                await api_base.api.send(
                                    {
                                        ticks_history:
                                            MARKET_SYMBOL,

                                        end: 'latest',

                                        count:
                                            HISTORY_SIZE,

                                        style:
                                            'ticks',

                                        subscribe:
                                            1,

                                        req_id:
                                            HISTORY_REQUEST_ID,
                                    }
                                );

                            if (
                                cancelled
                            ) {
                                return;
                            }

                            const history =
                                historyResponse
                                    ?.history;

                            const prices =
                                Array.isArray(
                                    history
                                        ?.prices
                                )
                                    ? history.prices
                                          .map(
                                              (
                                                  value: any
                                              ) =>
                                                  Number(
                                                      value
                                                  )
                                          )
                                          .filter(
                                              (
                                                  value: number
                                              ) =>
                                                  Number.isFinite(
                                                      value
                                                  )
                                          )
                                    : [];

                            if (
                                prices.length >
                                0
                            ) {
                                const limitedPrices =
                                    prices.slice(
                                        -HISTORY_SIZE
                                    );

                                pricesRef.current =
                                    limitedPrices;

                                const historyDirections: Direction[] =
                                    [];

                                for (
                                    let i = 1;
                                    i <
                                    limitedPrices.length;
                                    i++
                                ) {
                                    historyDirections.push(
                                        getDirection(
                                            limitedPrices[
                                                i -
                                                    1
                                            ],
                                            limitedPrices[
                                                i
                                            ]
                                        )
                                    );
                                }

                                directionsRef.current =
                                    historyDirections;

                                const lastPrice =
                                    limitedPrices[
                                        limitedPrices.length -
                                            1
                                    ];

                                previousPriceRef.current =
                                    lastPrice;

                                setPrice(
                                    lastPrice
                                );

                                setLastDigit(
                                    getLastDigit(
                                        lastPrice,
                                        5
                                    )
                                );

                                setHistoryCount(
                                    limitedPrices.length
                                );

                                setObservations(
                                    historyDirections.length
                                );

                                /*
                                 * Analyse immédiate
                                 * de l'historique.
                                 */
                                const analysis =
                                    calculatePrediction(
                                        historyDirections
                                    );

                                setPrediction(
                                    analysis.prediction
                                );

                                setPredictionStrength(
                                    analysis.strength
                                );

                                if (
                                    historyDirections.length >
                                    0
                                ) {
                                    const lastDirection =
                                        historyDirections[
                                            historyDirections.length -
                                                1
                                        ];

                                    setCurrentDirection(
                                        lastDirection
                                    );
                                }

                                if (
                                    analysis.prediction ===
                                    'UP'
                                ) {
                                    setEngineInfo(
                                        `🟢 UP ${analysis.strength.toFixed(
                                            1
                                        )}% • historique`
                                    );
                                } else if (
                                    analysis.prediction ===
                                    'DOWN'
                                ) {
                                    setEngineInfo(
                                        `🔴 DOWN ${analysis.strength.toFixed(
                                            1
                                        )}% • historique`
                                    );
                                } else {
                                    setEngineInfo(
                                        `⚪ STABLE ${analysis.strength.toFixed(
                                            1
                                        )}% • historique`
                                    );
                                }

                                setProposalStatus(
                                    `📚 Historique disponible : ${limitedPrices.length} tick(s)`
                                );
                            } else {
                                setProposalStatus(
                                    '🟠 Aucun historique EUR/USD disponible pour le moment.'
                                );
                            }
                        } catch (
                            historyError
                        ) {
                            /*
                             * Ne casse pas le flux live.
                             */
                            console.error(
                                '❌ Erreur historique EUR/USD:',
                                historyError
                            );
                        }

                        if (
                            cancelled
                        ) {
                            return;
                        }

                        /*
                         * =================================
                         * FLUX LIVE
                         * =================================
                         */
                        try {
                            api_base.api.send(
                                {
                                    ticks:
                                        MARKET_SYMBOL,

                                    subscribe:
                                        1,

                                    req_id:
                                        TICK_REQUEST_ID,
                                }
                            );
                        } catch (
                            tickError
                        ) {
                            console.error(
                                '❌ Erreur abonnement ticks:',
                                tickError
                            );
                        }

                        /*
                         * =================================
                         * BALANCE
                         * =================================
                         */
                        requestBalance();

                        if (
                            mountedRef.current
                        ) {
                            setConnection(
                                'waiting'
                            );

                            /*
                             * Si le marché est fermé,
                             * le message d'erreur Deriv
                             * pourra ensuite remettre
                             * l'état CLOSED.
                             */
                            setProposalStatus(
                                '🟢 Connexion prête — attente des ticks EUR/USD…'
                            );
                        }
                    } catch (
                        error
                    ) {
                        console.error(
                            '❌ Erreur connexion EUR/USD:',
                            error
                        );

                        if (
                            mountedRef.current
                        ) {
                            setConnection(
                                'error'
                            );

                            setProposalStatus(
                                `🔴 Erreur connexion : ${
                                    error instanceof
                                    Error
                                        ? error.message
                                        : 'erreur inconnue'
                                }`
                            );
                        }
                    }
                };

            startConnection();

            return () => {
                cancelled =
                    true;

                mountedRef.current =
                    false;

                if (
                    unsubscribeRef.current
                ) {
                    try {
                        unsubscribeRef.current();
                    } catch (
                        error
                    ) {
                        console.error(
                            'Erreur unsubscribe:',
                            error
                        );
                    }

                    unsubscribeRef.current =
                        null;
                }
            };
        }, [
            handleDerivMessage,
            initialiseApi,
            requestBalance,
        ]);

        /* =================================================
           PAPER TEST
        ================================================= */

        const startPaperTest =
            useCallback(() => {
                const reset: PaperResult =
                    {
                        total: 0,
                        wins: 0,
                        losses: 0,
                        pnl: 0,
                    };

                paperResultRef.current =
                    reset;

                setPaperResult(
                    reset
                );

                paperRunningRef.current =
                    true;

                setPaperRunning(
                    true
                );

                streakRef.current =
                    {
                        type: '—',
                        count: 0,
                    };

                setCurrentStreak(
                    0
                );

                setStreakType(
                    '—'
                );

                setLastResult(
                    '—'
                );

                setBlockWins(
                    0
                );

                setBlockLosses(
                    0
                );

                /*
                 * Le premier signal sera
                 * validé sur le tick suivant.
                 */
                previousPredictionRef.current =
                    prediction;

                setProposalStatus(
                    '🧪 Paper Test démarré — aucun ordre envoyé'
                );
            }, [prediction]);

        const stopPaperTest =
            useCallback(() => {
                paperRunningRef.current =
                    false;

                setPaperRunning(
                    false
                );

                setProposalStatus(
                    `⏹️ Paper Test arrêté — ${paperResultRef.current.total}/${PAPER_TEST_LIMIT}`
                );
            }, []);

        const resetPaperTest =
            useCallback(() => {
                paperRunningRef.current =
                    false;

                setPaperRunning(
                    false
                );

                const reset: PaperResult =
                    {
                        total: 0,
                        wins: 0,
                        losses: 0,
                        pnl: 0,
                    };

                paperResultRef.current =
                    reset;

                previousPredictionRef.current =
                    'FLAT';

                streakRef.current =
                    {
                        type: '—',
                        count: 0,
                    };

                setPaperResult(
                    reset
                );

                setLastResult(
                    '—'
                );

                setCurrentStreak(
                    0
                );

                setStreakType(
                    '—'
                );

                setBlockWins(
                    0
                );

                setBlockLosses(
                    0
                );

                setProposalStatus(
                    '🧹 Paper Test réinitialisé'
                );
            }, []);

        /* =================================================
           STATISTIQUES
        ================================================= */

        const winRate =
            useMemo(() => {
                if (
                    paperResult.total ===
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
                paperResult,
            ]);

        const lossRate =
            useMemo(() => {
                if (
                    paperResult.total ===
                    0
                ) {
                    return 0;
                }

                return (
                    (paperResult.losses /
                        paperResult.total) *
                    100
                );
            }, [
                paperResult,
            ]);

        const currentBlock =
            paperResult.total ===
            0
                ? 0
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

        const blocksCompleted =
            Math.floor(
                paperResult.total /
                    BLOCK_SIZE
            );

        const directionLabel =
            currentDirection ===
            'UP'
                ? '🟢 HAUSSE'
                : currentDirection ===
                  'DOWN'
                ? '🔴 BAISSE'
                : '⚪ STABLE';

        const predictionLabel =
            prediction === 'UP'
                ? '🟢 HAUSSE'
                : prediction ===
                  'DOWN'
                ? '🔴 BAISSE'
                : '⚪ STABLE';

        const connectionLabel =
            connection ===
            'connected'
                ? '🟢 Connecté à Deriv — EUR/USD'
                : connection ===
                  'waiting'
                ? '🟢 Connexion établie — attente EUR/USD'
                : connection ===
                  'closed'
                ? '🟠 Marché EUR/USD fermé'
                : connection ===
                  'error'
                ? '🔴 Erreur EUR/USD'
                : '🟠 Connexion à Deriv…';

        /* =================================================
           UI
        ================================================= */

        return (
            <div
                style={{
                    width:
                        '100%',
                    minHeight:
                        '100dvh',
                    overflowY:
                        'auto',
                    overflowX:
                        'hidden',
                    WebkitOverflowScrolling:
                        'touch',
                    overscrollBehaviorY:
                        'auto',
                    touchAction:
                        'pan-y',
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
                    <h1
                        style={{
                            fontSize:
                                '22px',
                            marginBottom:
                                '8px',
                        }}
                    >
                        📈 Moniteur Forex
                        EUR/USD —
                        V4.11.5
                    </h1>

                    <div
                        style={{
                            background:
                                '#1e293b',
                            padding:
                                '14px',
                            borderRadius:
                                '12px',
                            marginBottom:
                                '12px',
                        }}
                    >
                        <strong>
                            {connectionLabel}
                        </strong>

                        {marketMessage && (
                            <p>
                                🟠{' '}
                                {
                                    marketMessage
                                }
                            </p>
                        )}

                        {connection ===
                            'closed' && (
                            <p>
                                🔄 Le
                                moniteur
                                attend la
                                prochaine
                                ouverture
                                du marché.
                            </p>
                        )}
                    </div>

                    <div
                        style={{
                            background:
                                '#1e293b',
                            padding:
                                '14px',
                            borderRadius:
                                '12px',
                            marginBottom:
                                '12px',
                        }}
                    >
                        <h2>
                            💰 Compte
                            Deriv
                        </h2>

                        <div
                            style={{
                                fontSize:
                                    '22px',
                                fontWeight:
                                    'bold',
                            }}
                        >
                            {balance !==
                            null
                                ? `${balance.toFixed(
                                      2
                                  )} USD`
                                : '—'}
                        </div>

                        <div>
                            Compte :{' '}
                            {loginId}
                        </div>

                        <p>
                            {balance !==
                            null
                                ? '🟢 Solde reçu depuis Deriv'
                                : '🟠 En attente du solde'}
                        </p>
                    </div>

                    <div
                        style={{
                            background:
                                '#1e293b',
                            padding:
                                '14px',
                            borderRadius:
                                '12px',
                            marginBottom:
                                '12px',
                        }}
                    >
                        <h2>
                            📊 Marché
                        </h2>

                        <p>
                            <strong>
                                Marché
                            </strong>
                            <br />
                            {MARKET_NAME}
                        </p>

                        <p>
                            <strong>
                                Symbole
                            </strong>
                            <br />
                            {MARKET_SYMBOL}
                        </p>

                        <p>
                            <strong>
                                Prix
                            </strong>
                            <br />
                            {price !==
                            null
                                ? price.toFixed(
                                      5
                                  )
                                : '—'}
                        </p>

                        <p>
                            <strong>
                                Dernier chiffre
                            </strong>
                            <br />
                            {lastDigit}
                        </p>
                    </div>

                    <div
                        style={{
                            background:
                                '#1e293b',
                            padding:
                                '14px',
                            borderRadius:
                                '12px',
                            marginBottom:
                                '12px',
                        }}
                    >
                        <h2>
                            🧠 Phase 1 —
                            Apprentissage
                        </h2>

                        <p>
                            Historique :{' '}
                            {historyCount}/
                            {HISTORY_SIZE}
                        </p>

                        <p>
                            Observations :{' '}
                            {observations}
                        </p>

                        <p>
                            {historyCount >=
                            HISTORY_SIZE
                                ? '🟢 Historique complet'
                                : '🧠 Collecte de données…'}
                        </p>
                    </div>

                    <div
                        style={{
                            background:
                                '#1e293b',
                            padding:
                                '14px',
                            borderRadius:
                                '12px',
                            marginBottom:
                                '12px',
                        }}
                    >
                        <h2>
                            🧠 Moteur
                            V4.11.5
                        </h2>

                        <p>
                            <strong>
                                Direction
                                actuelle
                            </strong>
                            <br />
                            {
                                directionLabel
                            }
                        </p>

                        <p>
                            <strong>
                                Prédiction
                            </strong>
                            <br />
                            {
                                predictionLabel
                            }
                        </p>

                        <p>
                            <strong>
                                Force
                            </strong>
                            <br />
                            {predictionStrength.toFixed(
                                1
                            )}
                            %
                        </p>

                        <p>
                            <strong>
                                État moteur
                            </strong>
                            <br />
                            {
                                engineInfo
                            }
                        </p>

                        <div
                            style={{
                                background:
                                    '#334155',
                                padding:
                                    '10px',
                                borderRadius:
                                    '8px',
                                marginTop:
                                    '10px',
                            }}
                        >
                            🔎 Analyse :
                            transitions +
                            momentum +
                            mouvements
                            récents.
                        </div>
                    </div>

                    <div
                        style={{
                            background:
                                '#1e293b',
                            padding:
                                '14px',
                            borderRadius:
                                '12px',
                            marginBottom:
                                '12px',
                        }}
                    >
                        <h2>
                            🧪 Paper Test
                        </h2>

                        <p>
                            Aucun ordre
                            financier n'est
                            envoyé.
                        </p>

                        {!paperRunning ? (
                            <button
                                onClick={
                                    startPaperTest
                                }
                                style={{
                                    width:
                                        '100%',
                                    padding:
                                        '14px',
                                    borderRadius:
                                        '10px',
                                    border:
                                        'none',
                                    fontWeight:
                                        'bold',
                                    fontSize:
                                        '16px',
                                    cursor:
                                        'pointer',
                                }}
                            >
                                ▶️ TESTER
                                SUR COMPTE
                                DÉMO
                            </button>
                        ) : (
                            <button
                                onClick={
                                    stopPaperTest
                                }
                                style={{
                                    width:
                                        '100%',
                                    padding:
                                        '14px',
                                    borderRadius:
                                        '10px',
                                    border:
                                        'none',
                                    fontWeight:
                                        'bold',
                                    fontSize:
                                        '16px',
                                    cursor:
                                        'pointer',
                                }}
                            >
                                ⏹️ ARRÊTER
                                LE TEST
                            </button>
                        )}

                        <button
                            onClick={
                                resetPaperTest
                            }
                            style={{
                                width:
                                    '100%',
                                padding:
                                    '10px',
                                marginTop:
                                    '8px',
                                borderRadius:
                                    '10px',
                                border:
                                    'none',
                                cursor:
                                    'pointer',
                            }}
                        >
                            🔄 Réinitialiser
                        </button>

                        <p>
                            {
                                proposalStatus
                            }
                        </p>
                    </div>

                    <div
                        style={{
                            background:
                                '#1e293b',
                            padding:
                                '14px',
                            borderRadius:
                                '12px',
                            marginBottom:
                                '12px',
                        }}
                    >
                        <h2>
                            📊 Résultats
                        </h2>

                        <p>
                            <strong>
                                Tests
                            </strong>
                            <br />
                            {
                                paperResult.total
                            }
                            /
                            {
                                PAPER_TEST_LIMIT
                            }
                        </p>

                        <p>
                            <strong>
                                Gains
                            </strong>
                            <br />
                            {
                                paperResult.wins
                            }
                        </p>

                        <p>
                            <strong>
                                Pertes
                            </strong>
                            <br />
                            {
                                paperResult.losses
                            }
                        </p>

                        <p>
                            <strong>
                                Taux de gain
                            </strong>
                            <br />
                            {winRate.toFixed(
                                2
                            )}
                            %
                        </p>

                        <p>
                            <strong>
                                Taux de perte
                            </strong>
                            <br />
                            {lossRate.toFixed(
                                2
                            )}
                            %
                        </p>

                        <p>
                            <strong>
                                P/L virtuel
                            </strong>
                            <br />
                            {paperResult.pnl >=
                            0
                                ? '+'
                                : ''}
                            {
                                paperResult.pnl
                            }
                        </p>

                        <p>
                            <strong>
                                Dernier résultat
                            </strong>
                            <br />
                            {lastResult ===
                            'WIN'
                                ? '🟢 GAIN'
                                : lastResult ===
                                  'LOSS'
                                ? '🔴 PERTE'
                                : '—'}
                        </p>

                        <p>
                            <strong>
                                Série actuelle
                            </strong>
                            <br />
                            {streakType ===
                            'WIN'
                                ? `🟢 ${currentStreak} gain(s)`
                                : streakType ===
                                  'LOSS'
                                ? `🔴 ${currentStreak} perte(s)`
                                : '—'}
                        </p>
                    </div>

                    <div
                        style={{
                            background:
                                '#1e293b',
                            padding:
                                '14px',
                            borderRadius:
                                '12px',
                            marginBottom:
                                '12px',
                        }}
                    >
                        <h2>
                            📦 Blocs de
                            100
                        </h2>

                        <p>
                            Blocs terminés :{' '}
                            {
                                blocksCompleted
                            }
                        </p>

                        <p>
                            Bloc actuel :{' '}
                            {currentBlock}/10
                        </p>

                        <p>
                            Progression :{' '}
                            {
                                blockProgress
                            }
                            /100
                        </p>

                        <p>
                            Gains du bloc :{' '}
                            {
                                blockWins
                            }
                        </p>

                        <p>
                            Pertes du bloc :{' '}
                            {
                                blockLosses
                            }
                        </p>
                    </div>

                    <div
                        style={{
                            background:
                                '#172033',
                            padding:
                                '14px',
                            borderRadius:
                                '12px',
                            marginBottom:
                                '12px',
                        }}
                    >
                        <strong>
                            🛡️ SÉCURITÉ
                        </strong>

                        <p>
                            Cette version
                            fonctionne
                            uniquement en
                            analyse et Paper
                            Test.
                        </p>

                        <p>
                            ❌ Aucun
                            <strong>
                                {' '}
                                BUY
                            </strong>
                            <br />
                            ❌ Aucun
                            <strong>
                                {' '}
                                SELL
                            </strong>
                            <br />
                            ❌ Aucun trade
                            automatique.
                        </p>

                        <p>
                            Le P/L affiché est
                            entièrement
                            virtuel.
                        </p>
                    </div>

                    <div
                        style={{
                            background:
                                '#1e293b',
                            padding:
                                '14px',
                            borderRadius:
                                '12px',
                            marginBottom:
                                '12px',
                        }}
                    >
                        <h2>
                            ⚙️ État
                        </h2>

                        <p>
                            Flux strict :{' '}
                            {MARKET_SYMBOL}
                        </p>

                        <p>
                            Ticks conservés :{' '}
                            {pricesRef.current
                                .length}
                        </p>

                        <p>
                            Moteur :{' '}
                            V4.11.5
                        </p>

                        <p>
                            Mode :{' '}
                            {paperRunning
                                ? '🧪 PAPER EN COURS'
                                : '⚪ PAPER ARRÊTÉ'}
                        </p>
                    </div>

                    <div
                        style={{
                            textAlign:
                                'center',
                            padding:
                                '12px',
                        }}
                    >
                        ↕️ Fais glisser
                        l'écran pour voir
                        toutes les
                        informations
                    </div>
                </div>
            </div>
        );
    });

export default R75TickMonitor;

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api_base } from '../external/bot-skeleton/services/api/api-base';

const MARKET_SYMBOL = 'frxEURUSD';
const MARKET_NAME = 'EUR/USD';

const HISTORY_SIZE = 500;
const PAPER_TEST_LIMIT = 1000;
const BLOCK_SIZE = 100;
const ANALYSIS_WINDOW = 20;

type Direction = 'UP' | 'DOWN' | 'FLAT';

type Tick = {
    quote: number;
    epoch: number;
    direction: Direction;
};

type Stats = {
    wins: number;
    losses: number;
    virtual: number;
};

type BalanceInfo = {
    balance: number | null;
    currency: string;
    loginid: string;
};

type TestMode = 'idle' | 'testing' | 'stopped' | 'done';

type ProposalInfo = {
    id: string;
    askPrice: number | null;
    payout: number | null;
    spot: number | null;
    contractType: string;
    duration: number;
    durationUnit: string;
    direction: string;
};

const styles = {
    page: {
        width: '100%',
        height: '100dvh',
        minHeight: '100vh',
        overflowY: 'auto',
        overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch' as any,
        overscrollBehaviorY: 'auto' as any,
        touchAction: 'pan-y' as any,
        background: '#0f172a',
        color: '#e5e7eb',
        padding: '16px',
        paddingBottom: '70px',
        fontFamily: 'Arial, sans-serif',
        boxSizing: 'border-box' as any,
    },

    container: {
        width: '100%',
        maxWidth: '720px',
        margin: '0 auto',
    },

    title: {
        fontSize: '24px',
        fontWeight: 800,
        marginBottom: '6px',
        color: '#f8fafc',
    },

    subtitle: {
        fontSize: '13px',
        color: '#94a3b8',
        marginBottom: '16px',
    },

    card: {
        background: '#111827',
        border: '1px solid #1f2937',
        borderRadius: '16px',
        padding: '16px',
        marginBottom: '14px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
    },

    sectionTitle: {
        fontSize: '16px',
        fontWeight: 800,
        marginBottom: '12px',
        color: '#f8fafc',
    },

    row: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '12px',
        padding: '8px 0',
        borderBottom: '1px solid #1f2937',
    },

    label: {
        color: '#94a3b8',
        fontSize: '13px',
    },

    value: {
        color: '#f8fafc',
        fontWeight: 700,
        fontSize: '14px',
        textAlign: 'right' as const,
        wordBreak: 'break-word' as const,
    },

    button: {
        width: '100%',
        border: 'none',
        borderRadius: '12px',
        padding: '14px',
        fontSize: '15px',
        fontWeight: 800,
        cursor: 'pointer',
        marginTop: '8px',
    },

    input: {
        width: '100%',
        boxSizing: 'border-box' as const,
        background: '#0f172a',
        color: '#f8fafc',
        border: '1px solid #334155',
        borderRadius: '10px',
        padding: '12px',
        fontSize: '15px',
        outline: 'none',
    },

    badge: {
        display: 'inline-block',
        padding: '5px 9px',
        borderRadius: '999px',
        fontSize: '12px',
        fontWeight: 800,
    },

    small: {
        fontSize: '12px',
        lineHeight: 1.5,
        color: '#94a3b8',
    },
};

function calculateDirection(previous: number | null, current: number): Direction {
    if (previous === null) return 'FLAT';

    if (current > previous) return 'UP';
    if (current < previous) return 'DOWN';

    return 'FLAT';
}

function calculatePrediction(directions: Direction[]): {
    prediction: Direction;
    strength: number;
    observations: number;
} {
    const usable = directions
        .filter(direction => direction === 'UP' || direction === 'DOWN')
        .slice(-ANALYSIS_WINDOW);

    if (usable.length < 5) {
        return {
            prediction: 'FLAT',
            strength: 0,
            observations: usable.length,
        };
    }

    const up = usable.filter(direction => direction === 'UP').length;
    const down = usable.filter(direction => direction === 'DOWN').length;

    const prediction = up >= down ? 'UP' : 'DOWN';

    const strength =
        Math.round((Math.max(up, down) / usable.length) * 1000) / 10;

    return {
        prediction,
        strength,
        observations: usable.length,
    };
}

export default function ForexMonitorV412() {
    const [connected, setConnected] = useState(false);
    const [connectionMessage, setConnectionMessage] = useState(
        'Connexion à Deriv…'
    );

    const [price, setPrice] = useState<number | null>(null);
    const [lastDigit, setLastDigit] = useState<string>('—');

    const [ticks, setTicks] = useState<Tick[]>([]);
    const [historyCount, setHistoryCount] = useState(0);

    const [currentDirection, setCurrentDirection] =
        useState<Direction>('FLAT');

    const [prediction, setPrediction] = useState<Direction>('FLAT');
    const [strength, setStrength] = useState(0);
    const [observations, setObservations] = useState(0);

    const [balanceInfo, setBalanceInfo] = useState<BalanceInfo>({
        balance: null,
        currency: 'USD',
        loginid: '',
    });

    const [balanceStatus, setBalanceStatus] = useState(
        'En attente du solde…'
    );

    const [testMode, setTestMode] = useState<TestMode>('idle');

    const [paperStats, setPaperStats] = useState<Stats>({
        wins: 0,
        losses: 0,
        virtual: 0,
    });

    const [paperCount, setPaperCount] = useState(0);

    const [blockResults, setBlockResults] = useState<number[]>([]);

    const [finalPrediction, setFinalPrediction] =
        useState<Direction>('FLAT');

    const [statusMessage, setStatusMessage] = useState(
        'Prêt pour le test.'
    );

    /*
     * V4.12 — Proposition Demo
     */

    const [proposalAmount, setProposalAmount] = useState('1');

    const [proposal, setProposal] =
        useState<ProposalInfo | null>(null);

    const [proposalLoading, setProposalLoading] = useState(false);

    const [proposalMessage, setProposalMessage] = useState(
        'Aucune proposition demandée.'
    );

    const [proposalError, setProposalError] = useState('');

    const testCountRef = useRef(0);
    const statsRef = useRef<Stats>({
        wins: 0,
        losses: 0,
        virtual: 0,
    });

    const currentPredictionRef = useRef<Direction>('FLAT');

    const previousPriceRef = useRef<number | null>(null);

    const tickRequestIdRef = useRef(4801);
    const balanceRequestIdRef = useRef(4901);
    const proposalRequestIdRef = useRef(41201);

    const isMountedRef = useRef(true);

    const winRate = useMemo(() => {
        const total = paperStats.wins + paperStats.losses;

        if (total === 0) return 0;

        return (paperStats.wins / total) * 100;
    }, [paperStats]);

    const lossRate = useMemo(() => {
        const total = paperStats.wins + paperStats.losses;

        if (total === 0) return 0;

        return (paperStats.losses / total) * 100;
    }, [paperStats]);

    const averageBlock = useMemo(() => {
        if (blockResults.length === 0) return 0;

        return (
            blockResults.reduce((sum, value) => sum + value, 0) /
            blockResults.length
        );
    }, [blockResults]);

    const minBlock = useMemo(() => {
        if (blockResults.length === 0) return 0;

        return Math.min(...blockResults);
    }, [blockResults]);

    const maxBlock = useMemo(() => {
        if (blockResults.length === 0) return 0;

        return Math.max(...blockResults);
    }, [blockResults]);

    const predictionLabel =
        prediction === 'UP'
            ? '🟢 HAUSSE'
            : prediction === 'DOWN'
              ? '🔴 BAISSE'
              : '⚪ ATTENTE';

    const directionLabel =
        currentDirection === 'UP'
            ? '🟢 HAUSSE'
            : currentDirection === 'DOWN'
              ? '🔴 BAISSE'
              : '⚪ STABLE';

    /*
     * Balance
     */

    const requestCurrentBalance = () => {
        try {
            api_base.api.send({
                balance: 1,
                req_id: balanceRequestIdRef.current++,
            });

            setBalanceStatus('Demande de solde envoyée…');
        } catch (error) {
            setBalanceStatus('Erreur demande solde.');
        }
    };

    /*
     * Paper Test
     */

    const resetPaperTest = () => {
        const freshStats = {
            wins: 0,
            losses: 0,
            virtual: 0,
        };

        statsRef.current = freshStats;

        setPaperStats(freshStats);
        setPaperCount(0);
        setBlockResults([]);
        setFinalPrediction('FLAT');
        setTestMode('idle');
        setStatusMessage('Test réinitialisé.');
    };

    const stopDemoTest = () => {
        setTestMode('stopped');
        setStatusMessage(
            `Test arrêté à ${testCountRef.current}/${PAPER_TEST_LIMIT}.`
        );
    };

    const startDemoTest = () => {
        if (!connected) {
            setStatusMessage(
                '⚠️ Deriv n’est pas encore connecté.'
            );
            return;
        }

        if (ticks.length < HISTORY_SIZE) {
            setStatusMessage(
                `⚠️ Collecte de ${HISTORY_SIZE} ticks…`
            );
            return;
        }

        if (testCountRef.current >= PAPER_TEST_LIMIT) {
            setStatusMessage(
                'Test déjà terminé. Utilise Recommencer.'
            );
            return;
        }

        setTestMode('testing');

        setStatusMessage(
            '🟢 Test Demo démarré — mode virtuel.'
        );
    };

    /*
     * Traiter une nouvelle observation du paper test.
     */

    const processPaperObservation = (
        actualDirection: Direction
    ) => {
        if (testMode !== 'testing') return;

        const previousPrediction =
            currentPredictionRef.current;

        if (
            previousPrediction !== 'UP' &&
            previousPrediction !== 'DOWN'
        ) {
            return;
        }

        if (
            actualDirection !== 'UP' &&
            actualDirection !== 'DOWN'
        ) {
            return;
        }

        const nextCount = testCountRef.current + 1;

        const won =
            previousPrediction === actualDirection;

        const nextStats = {
            wins: statsRef.current.wins + (won ? 1 : 0),
            losses: statsRef.current.losses + (won ? 0 : 1),
            virtual:
                statsRef.current.virtual +
                (won ? 1 : -1),
        };

        statsRef.current = nextStats;
        testCountRef.current = nextCount;

        setPaperStats(nextStats);
        setPaperCount(nextCount);

        if (nextCount % BLOCK_SIZE === 0) {
            const blockWins = nextStats.wins;

            const previousBlocks =
                Math.floor(
                    (nextCount - BLOCK_SIZE) / BLOCK_SIZE
                );

            const previousWins =
                blockResults
                    .slice(0, previousBlocks)
                    .reduce(
                        (sum, block) =>
                            sum + Math.round(block),
                        0
                    );

            const currentBlockWins =
                blockWins - previousWins;

            const blockRate =
                currentBlockWins;

            setBlockResults(prev => [
                ...prev,
                blockRate,
            ]);
        }

        if (nextCount >= PAPER_TEST_LIMIT) {
            setTestMode('done');

            setFinalPrediction(
                currentPredictionRef.current
            );

            setStatusMessage(
                '✅ Test terminé — prédiction finale conservée.'
            );
        }
    };

    /*
     * Proposition Demo
     *
     * IMPORTANT:
     * Cette fonction demande uniquement un prix/proposal.
     * Elle n'appelle PAS "buy".
     */

    const requestDemoProposal = () => {
        if (!connected) {
            setProposalError(
                'Deriv n’est pas connecté.'
            );
            return;
        }

        if (
            prediction !== 'UP' &&
            prediction !== 'DOWN'
        ) {
            setProposalError(
                'Attends une prédiction HAUSSE ou BAISSE.'
            );
            return;
        }

        const amount = Number(proposalAmount);

        if (
            !Number.isFinite(amount) ||
            amount <= 0
        ) {
            setProposalError(
                'Montant invalide.'
            );
            return;
        }

        setProposalLoading(true);
        setProposal(null);
        setProposalError('');

        setProposalMessage(
            'Demande de proposition à Deriv…'
        );

        const contractType =
            prediction === 'UP'
                ? 'CALL'
                : 'PUT';

        const reqId =
            proposalRequestIdRef.current++;

        try {
            api_base.api.send({
                proposal: 1,
                amount,
                basis: 'stake',
                contract_type: contractType,
                currency: 'USD',
                duration: 1,
                duration_unit: 'm',
                underlying_symbol: MARKET_SYMBOL,
                req_id: reqId,
            });
        } catch (error) {
            setProposalLoading(false);
            setProposalError(
                'Impossible d’envoyer la demande de proposition.'
            );
        }
    };

    /*
     * Messages Deriv
     */

    useEffect(() => {
        isMountedRef.current = true;

        let unsubscribe: (() => void) | undefined;

        const processTick = (message: any) => {
            const tick = message?.tick;

            if (!tick) return;

            const quote = Number(tick.quote);

            if (!Number.isFinite(quote)) return;

            const direction = calculateDirection(
                previousPriceRef.current,
                quote
            );

            previousPriceRef.current = quote;

            setPrice(quote);

            const formatted =
                quote.toFixed(5);

            const digits =
                formatted.replace('.', '');

            const digit =
                digits.length > 0
                    ? digits[digits.length - 1]
                    : '—';

            setLastDigit(digit);

            setCurrentDirection(direction);

            setTicks(previousTicks => {
                const nextTicks = [
                    ...previousTicks,
                    {
                        quote,
                        epoch:
                            Number(tick.epoch) ||
                            Date.now(),
                        direction,
                    },
                ].slice(-HISTORY_SIZE);

                setHistoryCount(
                    nextTicks.length
                );

                const directions =
                    nextTicks.map(
                        item => item.direction
                    );

                const result =
                    calculatePrediction(
                        directions
                    );

                setPrediction(
                    result.prediction
                );

                setStrength(
                    result.strength
                );

                setObservations(
                    result.observations
                );

                currentPredictionRef.current =
                    result.prediction;

                return nextTicks;
            });

            processPaperObservation(direction);
        };

        const processBalance = (message: any) => {
            if (!message?.balance) return;

            const balance =
                Number(
                    message.balance.balance
                );

            const currency =
                message.balance.currency ||
                'USD';

            const loginid =
                message.balance.loginid ||
                '';

            setBalanceInfo({
                balance: Number.isFinite(balance)
                    ? balance
                    : null,
                currency,
                loginid,
            });

            setBalanceStatus(
                '🟢 Balance reçu de Deriv'
            );
        };

        const processProposal = (message: any) => {
            if (!message?.proposal) return;

            const data =
                message.proposal;

            const askPrice =
                Number(data.ask_price);

            const payout =
                Number(data.payout);

            const spot =
                Number(data.spot);

            const contractType =
                data.contract_type ||
                (prediction === 'UP'
                    ? 'CALL'
                    : 'PUT');

            const proposalData: ProposalInfo = {
                id: String(
                    data.id || '—'
                ),
                askPrice:
                    Number.isFinite(askPrice)
                        ? askPrice
                        : null,
                payout:
                    Number.isFinite(payout)
                        ? payout
                        : null,
                spot:
                    Number.isFinite(spot)
                        ? spot
                        : null,
                contractType,
                duration: 1,
                durationUnit: 'm',
                direction:
                    contractType === 'CALL'
                        ? 'HAUSSE'
                        : 'BAISSE',
            };

            setProposal(
                proposalData
            );

            setProposalLoading(false);

            setProposalMessage(
                '✅ Proposition reçue — aucun achat effectué.'
            );

            setProposalError('');
        };

        const processError = (message: any) => {
            if (!message?.error) return;

            const errorMessage =
                message.error.message ||
                'Erreur Deriv inconnue.';

            const reqId =
                message?.echo_req?.req_id;

            if (
                reqId ===
                balanceRequestIdRef.current
            ) {
                setBalanceStatus(
                    `⚠️ ${errorMessage}`
                );
            }

            setProposalLoading(false);

            setProposalError(
                errorMessage
            );

            setStatusMessage(
                `⚠️ Deriv : ${errorMessage}`
            );
        };

        const handleMessage = (message: any) => {
            if (!message) return;

            if (message.msg_type === 'tick') {
                processTick(message);
            }

            if (message.msg_type === 'balance') {
                processBalance(message);
            }

            if (message.msg_type === 'proposal') {
                processProposal(message);
            }

            if (message.error) {
                processError(message);
            }

            /*
             * Une réponse ping/authorize ou autre message
             * prouve que le canal répond.
             */
            if (
                message.msg_type === 'tick' ||
                message.msg_type === 'balance' ||
                message.msg_type === 'proposal' ||
                message.msg_type === 'authorize'
            ) {
                setConnected(true);

                setConnectionMessage(
                    '🟢 Connecté à Deriv — EUR/USD'
                );
            }
        };

        try {
            if (
                api_base?.api &&
                typeof api_base.api.onMessage ===
                    'function'
            ) {
                unsubscribe =
                    api_base.api.onMessage(
                        handleMessage
                    );
            }

            setConnectionMessage(
                'Connexion à Deriv…'
            );

            /*
             * Flux EUR/USD
             */
            api_base.api.send({
                ticks: MARKET_SYMBOL,
                subscribe: 1,
                req_id:
                    tickRequestIdRef.current++,
            });

            /*
             * Solde — requête ponctuelle.
             * Pas de subscribe pour éviter les doublons.
             */
            api_base.api.send({
                balance: 1,
                req_id:
                    balanceRequestIdRef.current++,
            });
        } catch (error) {
            setConnected(false);

            setConnectionMessage(
                '🔴 Erreur de connexion Deriv'
            );

            setStatusMessage(
                'Erreur lors de l’initialisation Deriv.'
            );
        }

        return () => {
            isMountedRef.current = false;

            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        };
    }, []);

    /*
     * Affichage du test
     */

    const testButtonText =
        testMode === 'testing'
            ? '⏹️ ARRÊTER LE TEST'
            : testMode === 'stopped'
              ? '▶️ REPRENDRE LE TEST'
              : testMode === 'done'
                ? '🔄 RECOMMENCER'
                : '▶️ TESTER SUR COMPTE DÉMO';

    const handleTestButton = () => {
        if (testMode === 'testing') {
            stopDemoTest();
            return;
        }

        if (testMode === 'done') {
            resetPaperTest();
            return;
        }

        startDemoTest();
    };

    return (
        <div style={styles.page}>
            <div style={styles.container}>
                <div style={styles.title}>
                    Moniteur Forex EUR/USD — V4.12
                </div>

                <div style={styles.subtitle}>
                    Demo + Paper Trader + Proposition
                </div>

                {/* CONNEXION */}

                <div style={styles.card}>
                    <div style={styles.sectionTitle}>
                        🔌 Connexion
                    </div>

                    <div style={styles.row}>
                        <span style={styles.label}>
                            État
                        </span>

                        <span style={styles.value}>
                            {connectionMessage}
                        </span>
                    </div>

                    <div style={styles.row}>
                        <span style={styles.label}>
                            Marché
                        </span>

                        <span style={styles.value}>
                            {MARKET_NAME}
                        </span>
                    </div>

                    <div style={styles.row}>
                        <span style={styles.label}>
                            Symbole
                        </span>

                        <span style={styles.value}>
                            {MARKET_SYMBOL}
                        </span>
                    </div>
                </div>

                {/* COMPTE */}

                <div style={styles.card}>
                    <div style={styles.sectionTitle}>
                        💰 Compte Demo
                    </div>

                    <div style={styles.row}>
                        <span style={styles.label}>
                            Balance
                        </span>

                        <span style={styles.value}>
                            {balanceInfo.balance !== null
                                ? `${balanceInfo.balance.toFixed(
                                      2
                                  )} ${
                                      balanceInfo.currency
                                  }`
                                : '—'}
                        </span>
                    </div>

                    <div style={styles.row}>
                        <span style={styles.label}>
                            Account
                        </span>

                        <span style={styles.value}>
                            {balanceInfo.loginid || '—'}
                        </span>
                    </div>

                    <div style={styles.small}>
                        {balanceStatus}
                    </div>

                    <button
                        type="button"
                        onClick={
                            requestCurrentBalance
                        }
                        style={{
                            ...styles.button,
                            background: '#334155',
                            color: '#f8fafc',
                        }}
                    >
                        🔄 ACTUALISER LE SOLDE
                    </button>
                </div>

                {/* MARCHÉ */}

                <div style={styles.card}>
                    <div style={styles.sectionTitle}>
                        📈 Marché
                    </div>

                    <div style={styles.row}>
                        <span style={styles.label}>
                            Prix
                        </span>

                        <span style={styles.value}>
                            {price !== null
                                ? price.toFixed(5)
                                : '—'}
                        </span>
                    </div>

                    <div style={styles.row}>
                        <span style={styles.label}>
                            Dernier chiffre
                        </span>

                        <span style={styles.value}>
                            {lastDigit}
                        </span>
                    </div>

                    <div style={styles.row}>
                        <span style={styles.label}>
                            Historique
                        </span>

                        <span style={styles.value}>
                            {historyCount}/{HISTORY_SIZE}
                        </span>
                    </div>

                    <div style={styles.row}>
                        <span style={styles.label}>
                            Direction actuelle
                        </span>

                        <span style={styles.value}>
                            {directionLabel}
                        </span>
                    </div>
                </div>

                {/* APPRENTISSAGE */}

                <div style={styles.card}>
                    <div style={styles.sectionTitle}>
                        🧠 Analyse
                    </div>

                    <div style={styles.row}>
                        <span style={styles.label}>
                            Prediction
                        </span>

                        <span style={styles.value}>
                            {predictionLabel}
                        </span>
                    </div>

                    <div style={styles.row}>
                        <span style={styles.label}>
                            Force
                        </span>

                        <span style={styles.value}>
                            {strength.toFixed(1)}%
                        </span>
                    </div>

                    <div style={styles.row}>
                        <span style={styles.label}>
                            Observations
                        </span>

                        <span style={styles.value}>
                            {observations}
                        </span>
                    </div>
                </div>

                {/* PROPOSITION DEMO */}

                <div
                    style={{
                        ...styles.card,
                        border:
                            '1px solid #334155',
                    }}
                >
                    <div style={styles.sectionTitle}>
                        🔐 Proposition Demo
                    </div>

                    <div
                        style={{
                            ...styles.small,
                            marginBottom: '12px',
                        }}
                    >
                        Cette étape demande uniquement
                        un prix de contrat à Deriv.
                        <strong>
                            {' '}
                            Aucun BUY n’est envoyé.
                        </strong>
                    </div>

                    <div style={styles.row}>
                        <span style={styles.label}>
                            Direction
                        </span>

                        <span style={styles.value}>
                            {prediction === 'UP'
                                ? '🟢 CALL / HAUSSE'
                                : prediction ===
                                    'DOWN'
                                  ? '🔴 PUT / BAISSE'
                                  : '⚪ Attente'}
                        </span>
                    </div>

                    <div
                        style={{
                            marginTop: '12px',
                        }}
                    >
                        <div
                            style={{
                                ...styles.label,
                                marginBottom: '7px',
                            }}
                        >
                            Montant Demo
                        </div>

                        <input
                            value={proposalAmount}
                            onChange={event =>
                                setProposalAmount(
                                    event.target.value
                                )
                            }
                            inputMode="decimal"
                            type="number"
                            min="0.35"
                            step="0.01"
                            style={styles.input}
                        />
                    </div>

                    <button
                        type="button"
                        onClick={
                            requestDemoProposal
                        }
                        disabled={
                            proposalLoading ||
                            !connected ||
                            (prediction !== 'UP' &&
                                prediction !==
                                    'DOWN')
                        }
                        style={{
                            ...styles.button,
                            background:
                                proposalLoading
                                    ? '#475569'
                                    : '#2563eb',
                            color: '#fff',
                            opacity:
                                !connected ||
                                (prediction !== 'UP' &&
                                    prediction !==
                                        'DOWN')
                                    ? 0.55
                                    : 1,
                        }}
                    >
                        {proposalLoading
                            ? '⏳ DEMANDE EN COURS…'
                            : '💵 OBTENIR PROPOSITION DEMO'}
                    </button>

                    <div
                        style={{
                            marginTop: '12px',
                            padding: '10px',
                            borderRadius: '10px',
                            background: '#0f172a',
                            fontSize: '12px',
                            lineHeight: 1.5,
                        }}
                    >
                        {proposalMessage}
                    </div>

                    {proposalError && (
                        <div
                            style={{
                                marginTop: '10px',
                                padding: '10px',
                                borderRadius: '10px',
                                background: '#450a0a',
                                color: '#fecaca',
                                fontSize: '12px',
                                lineHeight: 1.5,
                            }}
                        >
                            ⚠️ {proposalError}
                        </div>
                    )}

                    {proposal && (
                        <div
                            style={{
                                marginTop: '12px',
                                padding: '12px',
                                borderRadius: '12px',
                                background: '#052e16',
                                border:
                                    '1px solid #166534',
                            }}
                        >
                            <div
                                style={{
                                    fontWeight: 800,
                                    marginBottom: '8px',
                                    color: '#bbf7d0',
                                }}
                            >
                                ✅ PROPOSITION REÇUE
                            </div>

                            <div style={styles.row}>
                                <span
                                    style={
                                        styles.label
                                    }
                                >
                                    ID
                                </span>

                                <span
                                    style={
                                        styles.value
                                    }
                                >
                                    {proposal.id}
                                </span>
                            </div>

                            <div style={styles.row}>
                                <span
                                    style={
                                        styles.label
                                    }
                                >
                                    Contrat
                                </span>

                                <span
                                    style={
                                        styles.value
                                    }
                                >
                                    {proposal.contractType}
                                </span>
                            </div>

                            <div style={styles.row}>
                                <span
                                    style={
                                        styles.label
                                    }
                                >
                                    Direction
                                </span>

                                <span
                                    style={
                                        styles.value
                                    }
                                >
                                    {proposal.direction}
                                </span>
                            </div>

                            <div style={styles.row}>
                                <span
                                    style={
                                        styles.label
                                    }
                                >
                                    Ask Price
                                </span>

                                <span
                                    style={
                                        styles.value
                                    }
                                >
                                    {proposal.askPrice !==
                                    null
                                        ? proposal.askPrice.toFixed(
                                              2
                                          )
                                        : '—'}{' '}
                                    USD
                                </span>
                            </div>

                            <div style={styles.row}>
                                <span
                                    style={
                                        styles.label
                                    }
                                >
                                    Payout
                                </span>

                                <span
                                    style={
                                        styles.value
                                    }
                                >
                                    {proposal.payout !==
                                    null
                                        ? proposal.payout.toFixed(
                                              2
                                          )
                                        : '—'}{' '}
                                    USD
                                </span>
                            </div>

                            <div style={styles.row}>
                                <span
                                    style={
                                        styles.label
                                    }
                                >
                                    Spot
                                </span>

                                <span
                                    style={
                                        styles.value
                                    }
                                >
                                    {proposal.spot !==
                                    null
                                        ? proposal.spot.toFixed(
                                              5
                                          )
                                        : '—'}
                                </span>
                            </div>

                            <div
                                style={{
                                    ...styles.small,
                                    marginTop: '10px',
                                    color: '#86efac',
                                }}
                            >
                                🔒 Aucun achat effectué.
                                Cette V4.12 s’arrête à
                                la proposition.
                            </div>
                        </div>
                    )}
                </div>

                {/* TEST DEMO / PAPER */}

                <div style={styles.card}>
                    <div style={styles.sectionTitle}>
                        🧪 Test Demo
                    </div>

                    <div style={styles.small}>
                        Le bouton démarre le test de la
                        stratégie avec les ticks EUR/USD
                        en mode virtuel.
                    </div>

                    <button
                        type="button"
                        onClick={handleTestButton}
                        style={{
                            ...styles.button,
                            background:
                                testMode === 'testing'
                                    ? '#dc2626'
                                    : '#16a34a',
                            color: '#fff',
                        }}
                    >
                        {testButtonText}
                    </button>

                    <button
                        type="button"
                        onClick={resetPaperTest}
                        style={{
                            ...styles.button,
                            background: '#334155',
                            color: '#f8fafc',
                        }}
                    >
                        ♻️ RÉINITIALISER
                    </button>
                </div>

                {/* PAPER TRADING */}

                <div style={styles.card}>
                    <div style={styles.sectionTitle}>
                        📊 Paper Trading
                    </div>

                    <div style={styles.row}>
                        <span style={styles.label}>
                            Observations
                        </span>

                        <span style={styles.value}>
                            {paperCount}/
                            {PAPER_TEST_LIMIT}
                        </span>
                    </div>

                    <div style={styles.row}>
                        <span style={styles.label}>
                            Wins
                        </span>

                        <span style={styles.value}>
                            {paperStats.wins}
                        </span>
                    </div>

                    <div style={styles.row}>
                        <span style={styles.label}>
                            Losses
                        </span>

                        <span style={styles.value}>
                            {paperStats.losses}
                        </span>
                    </div>

                    <div style={styles.row}>
                        <span style={styles.label}>
                            Win rate
                        </span>

                        <span style={styles.value}>
                            {winRate.toFixed(2)}%
                        </span>
                    </div>

                    <div style={styles.row}>
                        <span style={styles.label}>
                            Loss rate
                        </span>

                        <span style={styles.value}>
                            {lossRate.toFixed(2)}%
                        </span>
                    </div>

                    <div style={styles.row}>
                        <span style={styles.label}>
                            Virtual P/L
                        </span>

                        <span style={styles.value}>
                            {paperStats.virtual >= 0
                                ? '+'
                                : ''}
                            {paperStats.virtual}
                        </span>
                    </div>

                    <div
                        style={{
                            marginTop: '12px',
                            padding: '10px',
                            borderRadius: '10px',
                            background: '#0f172a',
                            fontSize: '12px',
                        }}
                    >
                        {paperCount >=
                        PAPER_TEST_LIMIT
                            ? '✅ Test de 1000 observations terminé.'
                            : testMode ===
                                'testing'
                              ? `🟢 Test en cours : ${paperCount}/${PAPER_TEST_LIMIT}`
                              : testMode ===
                                  'stopped'
                                ? `⏸️ Test arrêté : ${paperCount}/${PAPER_TEST_LIMIT}`
                                : '⚪ Test non démarré.'}
                    </div>
                </div>

                {/* BLOCS */}

                <div style={styles.card}>
                    <div style={styles.sectionTitle}>
                        📦 Blocs de 100
                    </div>

                    <div style={styles.row}>
                        <span style={styles.label}>
                            Blocs terminés
                        </span>

                        <span style={styles.value}>
                            {blockResults.length}
                        </span>
                    </div>

                    <div style={styles.row}>
                        <span style={styles.label}>
                            Moyenne
                        </span>

                        <span style={styles.value}>
                            {averageBlock.toFixed(2)}%
                        </span>
                    </div>

                    <div style={styles.row}>
                        <span style={styles.label}>
                            Minimum
                        </span>

                        <span style={styles.value}>
                            {minBlock.toFixed(2)}%
                        </span>
                    </div>

                    <div style={styles.row}>
                        <span style={styles.label}>
                            Maximum
                        </span>

                        <span style={styles.value}>
                            {maxBlock.toFixed(2)}%
                        </span>
                    </div>
                </div>

                {/* STATUT */}

                <div style={styles.card}>
                    <div style={styles.sectionTitle}>
                        📌 Statut
                    </div>

                    <div
                        style={{
                            padding: '12px',
                            borderRadius: '12px',
                            background: '#0f172a',
                            lineHeight: 1.5,
                            fontSize: '13px',
                        }}
                    >
                        {statusMessage}
                    </div>

                    <div
                        style={{
                            marginTop: '12px',
                            padding: '12px',
                            borderRadius: '12px',
                            background: '#172554',
                            color: '#bfdbfe',
                            fontSize: '12px',
                            lineHeight: 1.5,
                        }}
                    >
                        Prédiction finale :{' '}
                        <strong>
                            {finalPrediction ===
                            'UP'
                                ? '🟢 HAUSSE'
                                : finalPrediction ===
                                    'DOWN'
                                  ? '🔴 BAISSE'
                                  : '⚪ —'}
                        </strong>
                    </div>
                </div>

                {/* SÉCURITÉ */}

                <div
                    style={{
                        ...styles.card,
                        border:
                            '1px solid #166534',
                        background: '#052e16',
                    }}
                >
                    <div
                        style={{
                            ...styles.sectionTitle,
                            color: '#bbf7d0',
                        }}
                    >
                        🔒 Sécurité V4.12
                    </div>

                    <div
                        style={{
                            color: '#bbf7d0',
                            fontSize: '12px',
                            lineHeight: 1.6,
                        }}
                    >
                        ✅ Compte Demo uniquement.
                        <br />
                        ✅ Paper Test totalement
                        virtuel.
                        <br />
                        ✅ Proposition Demo
                        uniquement.
                        <br />
                        ❌ Aucun BUY envoyé.
                        <br />
                        ❌ Aucun ordre réel.
                        <br />
                        ❌ Aucun compte réel utilisé.
                    </div>
                </div>

                <div
                    style={{
                        textAlign: 'center',
                        color: '#64748b',
                        fontSize: '11px',
                        padding: '10px 0 20px',
                    }}
                >
                    Prediction Forex EUR/USD —
                    V4.12
                </div>
            </div>
        </div>
    );
}

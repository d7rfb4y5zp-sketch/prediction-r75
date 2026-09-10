import React, { lazy, Suspense, useEffect } from 'react';
import { observer } from 'mobx-react-lite';

import AuthLoadingWrapper from '@/components/auth-loading-wrapper';
import { botNotification } from '@/components/bot-notification/bot-notification';
import useLiveChat from '@/components/chat/useLiveChat';
import ChunkLoader from '@/components/loader/chunk-loader';
import { getUrlBase } from '@/components/shared';

import { api_base, ApiHelpers, ServerTime } from '@/external/bot-skeleton';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';

import { useApiBase } from '@/hooks/useApiBase';
import useDevMode from '@/hooks/useDevMode';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import { useStore } from '@/hooks/useStore';

import { isPreviewMode } from '@/utils/is-preview-mode';

import { setSmartChartsPublicPath } from '@deriv-com/smartcharts-champion';
import { localize } from '@deriv-com/translations';

import Audio from '../components/audio';
import BotStopped from '../components/bot-stopped';

import Main from '../pages/main';
import BotBuilder from '../pages/bot-builder';

import './app.scss';
import '../components/bot-notification/bot-notification.scss';

const PreviewBranding =
    process.env.NEXT_PUBLIC_APP_BUILD === 'true'
        ? lazy(() => import('../preview/preview-branding'))
        : null;

const AppContent = observer(() => {
    const [is_api_initialized, setIsApiInitialized] =
        React.useState(false);

    const [is_loading, setIsLoading] =
        React.useState(true);

    const store = useStore();

    const { app, transactions, common, client } = store;

    const {
        recovered_transactions,
        recoverPendingContracts,
    } = transactions;

    const is_subscribed_to_msg_listener =
        React.useRef(false);

    const msg_listener = React.useRef(null);

    const { connectionStatus } = useApiBase();

    useThemeSwitcher();
    useDevMode();

    useEffect(() => {
        if (isPreviewMode()) return;

        if (!process.env.NEXT_PUBLIC_DERIV_APP_ID) {
            botNotification(
                localize(
                    'Waiting for environment variables to be set…'
                ),
                undefined,
                { type: 'warning' }
            );
        }
    }, []);

    const livechat_client_information = {
        is_client_store_initialized: client?.is_logged_in
            ? true
            : !!client,

        is_logged_in: client?.is_logged_in,

        loginid: client?.loginid,

        currency: client?.currency,

        residence: client?.residence,

        email: '',

        first_name: '',

        last_name: '',
    };

    useLiveChat(
        livechat_client_information
    );

    useEffect(() => {
        if (
            connectionStatus ===
            CONNECTION_STATUS.OPENED
        ) {
            setIsApiInitialized(true);

            common.setSocketOpened(true);
        } else {
            common.setSocketOpened(false);
        }
    }, [
        common,
        connectionStatus,
    ]);

    const {
        current_language,
    } = common;

    const html = document.documentElement;

    React.useEffect(() => {
        html?.setAttribute(
            'lang',
            current_language.toLowerCase()
        );

        html?.setAttribute(
            'dir',
            current_language.toLowerCase() === 'ar'
                ? 'rtl'
                : 'ltr'
        );
    }, [
        current_language,
        html,
    ]);

    const handleMessage =
        React.useCallback(
            ({ data }) => {
                if (
                    data?.msg_type ===
                        'proposal_open_contract' &&
                    !data?.error
                ) {
                    const {
                        proposal_open_contract,
                    } = data;

                    if (
                        proposal_open_contract?.status !==
                            'open' &&
                        !recovered_transactions?.includes(
                            proposal_open_contract?.contract_id
                        )
                    ) {
                        recoverPendingContracts(
                            proposal_open_contract
                        );
                    }
                }
            },
            [
                recovered_transactions,
                recoverPendingContracts,
            ]
        );

    React.useEffect(() => {
        setSmartChartsPublicPath(
            getUrlBase(
                '/js/smartcharts/'
            )
        );
    }, []);

    React.useEffect(() => {
        if (
            !is_subscribed_to_msg_listener.current &&
            client.is_logged_in &&
            is_api_initialized &&
            api_base?.api
        ) {
            is_subscribed_to_msg_listener.current =
                true;

            msg_listener.current =
                api_base.api
                    .onMessage()
                    ?.subscribe(
                        handleMessage
                    );
        }

        return () => {
            if (
                is_subscribed_to_msg_listener.current &&
                msg_listener.current
            ) {
                is_subscribed_to_msg_listener.current =
                    false;

                msg_listener.current.unsubscribe?.();
            }
        };
    }, [
        is_api_initialized,
        client.is_logged_in,
        client.loginid,
        handleMessage,
        connectionStatus,
    ]);

    const init = () => {
        ServerTime.init(common);

        app.setDBotEngineStores();

        ApiHelpers.setInstance(
            app.api_helpers_store
        );

        import('@/utils/gtm').then(
            ({ default: GTM }) => {
                GTM.init(store);
            }
        );
    };

    const changeActiveSymbolLoadingState =
        () => {
            init();

            const retrieveActiveSymbols =
                () => {
                    const {
                        active_symbols,
                    } = ApiHelpers.instance;

                    active_symbols
                        .retrieveActiveSymbols(
                            true
                        )
                        .then(() => {
                            setIsLoading(
                                false
                            );
                        });
                };

            if (
                ApiHelpers?.instance
                    ?.active_symbols
            ) {
                retrieveActiveSymbols();
            } else {
                const intervalId =
                    setInterval(() => {
                        if (
                            ApiHelpers
                                ?.instance
                                ?.active_symbols
                        ) {
                            clearInterval(
                                intervalId
                            );

                            retrieveActiveSymbols();
                        }
                    }, 1000);
            }
        };

    React.useEffect(() => {
        if (is_api_initialized) {
            init();

            setIsLoading(true);

            if (!client.is_logged_in) {
                changeActiveSymbolLoadingState();
            }
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        is_api_initialized,
    ]);

    React.useEffect(() => {
        if (
            client.is_logged_in &&
            is_api_initialized
        ) {
            changeActiveSymbolLoadingState();
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        is_api_initialized,
        client.loginid,
    ]);

    if (common?.error) {
        return null;
    }

    return (
        <React.Fragment>

            {PreviewBranding && (
                <Suspense fallback={null}>
                    <PreviewBranding
                        uiReady={!is_loading}
                    />
                </Suspense>
            )}

            {is_loading ? (
                <ChunkLoader
                    message={localize(
                        'Initializing Deriv Bot account...'
                    )}
                />
            ) : (
                <AuthLoadingWrapper>

                    <div
                        className="bot-dashboard bot"
                        data-testid="dt_bot_dashboard"
                    >

                        <Main />

                        <BotBuilder />

                        <Audio />

                        <BotStopped />

                    </div>

                </AuthLoadingWrapper>
            )}

        </React.Fragment>
    );
});

export default AppContent;

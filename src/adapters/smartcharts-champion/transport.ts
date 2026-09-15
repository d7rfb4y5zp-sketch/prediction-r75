/**
 * Transport layer wrapper for SmartCharts Champion Adapter
 *
 * Connects SmartCharts Champion to the existing Deriv chart_api.
 */
import chart_api from '@/external/bot-skeleton/services/api/chart-api';
import type { TTransport } from './types';
type StoredSubscription = {
    request: any;
    callback: (response: any) => void;
    messageSubscription?: any;
    realSubscriptionId: string | null;
};
const logger = {
    log: (...args: any[]) => {
        if (import.meta.env?.DEV) {
            console.log('[SmartCharts Transport]', ...args);
        }
    },
    warn: console.warn.bind(console, '[SmartCharts Transport]'),
    error: console.error.bind(console, '[SmartCharts Transport]'),
};
export function createTransport(): TTransport {
    const subscriptions = new Map<string, StoredSubscription>();
    /**
     * Make sure the Deriv API connection exists.
     */
    const ensureApi = async () => {
        if (!chart_api.api) {
            await chart_api.init();
        }
        if (!chart_api.api) {
            throw new Error('Deriv Chart API is not initialized');
        }
        return chart_api.api;
    };
    return {
        /**
         * Send a one-shot Deriv API request.
         */
        async send(request: any): Promise<any> {
            const api = await ensureApi();
            logger.log('SEND', request);
            try {
                const response = await api.send(request);
                logger.log('RESPONSE', response);
                return response;
            } catch (error) {
                logger.error('Send failed', error, request);
                throw error;
            }
        },
        /**
         * Subscribe to real-time Deriv data.
         *
         * SmartCharts expects:
         *   subscribe(request, callback) -> subscriptionId
         */
        subscribe(
            request: any,
            callback: (response: any) => void
        ): string {
            if (!chart_api.api) {
                throw new Error('Deriv Chart API not initialized');
            }
            const api = chart_api.api;
            const tempId = `smartcharts-${Date.now()}-${Math.random()
                .toString(36)
                .slice(2)}`;
            const subscribeRequest = {
                ...request,
                subscribe: 1,
            };
            const storedSubscription: StoredSubscription = {
                request: subscribeRequest,
                callback,
                messageSubscription: undefined,
                realSubscriptionId: null,
            };
            subscriptions.set(tempId, storedSubscription);
            logger.log('SUBSCRIBE', {
                tempId,
                request: subscribeRequest,
            });
            /**
             * Listen for WebSocket messages.
             *
             * IMPORTANT:
             * We do NOT assign the first random subscription ID
             * we receive to this subscription.
             *
             * We only forward messages after the real subscription
             * ID has been obtained from the initial API response.
             */
            const messageObservable = api.onMessage?.();
            if (messageObservable?.subscribe) {
                storedSubscription.messageSubscription =
                    messageObservable.subscribe(
                        ({ data }: { data: any }) => {
                            const current =
                                subscriptions.get(tempId);
                            if (!current) {
                                return;
                            }
                            const messageSubscriptionId =
                                data?.subscription?.id;
                            if (!messageSubscriptionId) {
                                return;
                            }
                            if (
                                current.realSubscriptionId &&
                                messageSubscriptionId ===
                                    current.realSubscriptionId
                            ) {
                                logger.log(
                                    'STREAM',
                                    messageSubscriptionId,
                                    data
                                );
                                current.callback(data);
                            }
                        }
                    );
            }
            /**
             * Send the actual subscription request.
             */
            api.send(subscribeRequest)
                .then((response: any) => {
                    const current = subscriptions.get(tempId);
                    if (!current) {
                        return;
                    }
                    const realSubscriptionId =
                        response?.subscription?.id;
                    if (!realSubscriptionId) {
                        logger.error(
                            'Subscription response has no subscription ID',
                            response
                        );
                        return;
                    }
                    current.realSubscriptionId =
                        realSubscriptionId;
                    subscriptions.set(tempId, current);
                    logger.log('SUBSCRIBED', {
                        tempId,
                        realSubscriptionId,
                    });
                    /**
                     * Send the initial response to SmartCharts.
                     *
                     * This is important for the first live quote/candle.
                     */
                    current.callback(response);
                })
                .catch((error: any) => {
                    logger.error(
                        'Subscription request failed',
                        error
                    );
                    const current =
                        subscriptions.get(tempId);
                    if (current?.messageSubscription) {
                        current.messageSubscription.unsubscribe();
                    }
                    subscriptions.delete(tempId);
                });
            return tempId;
        },
        /**
         * Unsubscribe one SmartCharts subscription.
         */
        unsubscribe(subscriptionId: string): void {
            const subscription =
                subscriptions.get(subscriptionId);
            if (!subscription) {
                logger.warn(
                    'Subscription not found:',
                    subscriptionId
                );
                return;
            }
            logger.log('UNSUBSCRIBE', {
                tempId: subscriptionId,
                realSubscriptionId:
                    subscription.realSubscriptionId,
            });
            /**
             * Stop local RxJS/WebSocket listener.
             */
            if (subscription.messageSubscription) {
                subscription.messageSubscription.unsubscribe();
            }
            /**
             * Tell Deriv to forget the real subscription.
             */
            if (
                chart_api.api &&
                subscription.realSubscriptionId
            ) {
                try {
                    chart_api.api.forget(
                        subscription.realSubscriptionId
                    );
                } catch (error) {
                    logger.warn(
                        'Unable to forget subscription',
                        error
                    );
                }
            }
            subscriptions.delete(subscriptionId);
        },
        /**
         * Unsubscribe all subscriptions.
         */
        unsubscribeAll(msgType?: string): void {
            logger.log(
                'UNSUBSCRIBE ALL',
                msgType
            );
            if (chart_api.api) {
                try {
                    if (msgType) {
                        chart_api.api.forgetAll(msgType);
                    } else {
                        chart_api.api.forgetAll('ticks');
                    }
                } catch (error) {
                    logger.warn(
                        'Unable to forget all subscriptions',
                        error
                    );
                }
            }
            /**
             * Remove all local listeners.
             */
            subscriptions.forEach(subscription => {
                if (subscription.messageSubscription) {
                    subscription.messageSubscription.unsubscribe();
                }
            });
            subscriptions.clear();
        },
    };
}

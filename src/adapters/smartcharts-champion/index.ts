/**
 * SmartCharts Champion Adapter
 * Provides the adapter pattern implementation for migrating
 * from derivatives-charts to smartcharts-champion.
 */

import { ActiveSymbol } from '@deriv-com/smartcharts-champion';

import type {
    ActiveSymbols,
    AdapterConfig,
    SmartchartsChampionAdapter,
    TGetQuotesRequest,
    TGetQuotesResult,
    TGranularity,
    TQuote,
    TradingTimesMap,
    TServices,
    TSubscriptionCallback,
    TTransport,
    TUnsubscribeFunction,
} from './types';

/**
 * Transformation utilities
 */
const transformations = {
    /**
     * Transform Deriv API ticks_history response
     * to the SmartCharts TGetQuotesResult format.
     */
    toTGetQuotesResult(
        response: any,
        granularity: TGranularity
    ): TGetQuotesResult {
        const quotes: TQuote[] = [];

        if (!response) {
            return {
                quotes,
                meta: {
                    symbol: '',
                    granularity,
                },
            };
        }

        const { history, candles, prices, times } = response;

        const symbol =
            response.echo_req?.ticks_history ||
            response.echo_req?.ticks ||
            '';

        /**
         * Tick data
         */
        if (granularity === 0 && history) {
            const tickPrices = history.prices;
            const tickTimes = history.times;

            if (
                Array.isArray(tickPrices) &&
                Array.isArray(tickTimes)
            ) {
                for (
                    let i = 0;
                    i < Math.min(tickPrices.length, tickTimes.length);
                    i++
                ) {
                    quotes.push({
                        Date: String(tickTimes[i]),
                        Close: tickPrices[i],
                        DT: new Date(tickTimes[i] * 1000),
                    });
                }
            }
        }

        /**
         * Candle data
         */
        else if (granularity > 0 && Array.isArray(candles)) {
            candles.forEach((candle: any) => {
                if (candle?.epoch === undefined) return;

                quotes.push({
                    Date: String(candle.epoch),
                    Open: candle.open,
                    High: candle.high,
                    Low: candle.low,
                    Close: candle.close,
                    DT: new Date(candle.epoch * 1000),
                });
            });
        }

        /**
         * Fallback for direct prices/times arrays
         */
        else if (
            Array.isArray(prices) &&
            Array.isArray(times)
        ) {
            for (
                let i = 0;
                i < Math.min(prices.length, times.length);
                i++
            ) {
                quotes.push({
                    Date: String(times[i]),
                    Close: prices[i],
                    DT: new Date(times[i] * 1000),
                });
            }
        }

        return {
            quotes,
            meta: {
                symbol,
                granularity,
                delay_amount: response.pip_size || 0,
            },
        };
    },

    /**
     * Transform a live Deriv tick/candle response
     * into a SmartCharts quote.
     */
    toTQuoteFromStream(
        message: any,
        granularity: TGranularity
    ): TQuote | null {
        if (!message) {
            return null;
        }

        /**
         * Live tick
         */
        if (granularity === 0 && message.tick) {
            const { tick } = message;

            if (
                tick.quote === undefined ||
                tick.epoch === undefined
            ) {
                return null;
            }

            return {
                Date: String(tick.epoch),
                Close: tick.quote,
                tick,
                DT: new Date(tick.epoch * 1000),
            };
        }

        /**
         * Live candle
         */
        if (granularity > 0 && message.ohlc) {
            const { ohlc } = message;

            if (
                ohlc.close === undefined ||
                ohlc.epoch === undefined
            ) {
                return null;
            }

            return {
                Date: String(ohlc.epoch),
                Open: ohlc.open,
                High: ohlc.high,
                Low: ohlc.low,
                Close: ohlc.close,
                ohlc,
                DT: new Date(ohlc.epoch * 1000),
            };
        }

        /**
         * Direct tick fallback
         */
        if (
            message.epoch !== undefined &&
            (message.quote !== undefined ||
                message.price !== undefined)
        ) {
            const quote =
                message.quote !== undefined
                    ? message.quote
                    : message.price;

            return {
                Date: String(message.epoch),
                Close: quote,
                DT: new Date(message.epoch * 1000),
            };
        }

        return null;
    },

    /**
     * Transform active symbols response
     * to SmartCharts ActiveSymbol format.
     */
    toActiveSymbols(
        activeSymbolsData: any[]
    ): ActiveSymbol[] {
        const symbols: ActiveSymbol[] = [];

        if (!Array.isArray(activeSymbolsData)) {
            return symbols;
        }

        for (const symbol of activeSymbolsData) {
            if (!symbol) continue;

            const symbolCode =
                symbol.underlying_symbol ||
                symbol.symbol;

            if (!symbolCode) continue;

            symbols.push({
                display_name:
                    symbol.display_name ||
                    symbolCode,

                market: symbol.market,

                market_display_name:
                    symbol.market_display_name,

                subgroup: symbol.subgroup,

                subgroup_display_name:
                    symbol.subgroup_display_name,

                submarket: symbol.submarket,

                submarket_display_name:
                    symbol.submarket_display_name,

                symbol: symbolCode,

                symbol_type:
                    symbol.symbol_type || '',

                pip:
                    symbol.pip ||
                    symbol.pip_size ||
                    0.01,

                exchange_is_open:
                    symbol.exchange_is_open || 0,

                is_trading_suspended:
                    symbol.is_trading_suspended || 0,

                delay_amount:
                    symbol.delay_amount,
            });
        }

        return symbols;
    },

    /**
     * Transform trading times data
     * to SmartCharts format.
     */
    toTradingTimesMap(
        tradingTimesData: any
    ): TradingTimesMap {
        const tradingTimes: TradingTimesMap = {};

        if (
            !tradingTimesData ||
            typeof tradingTimesData !== 'object'
        ) {
            return tradingTimes;
        }

        Object.keys(tradingTimesData).forEach(symbol => {
            const symbolData =
                tradingTimesData[symbol];

            if (!symbolData) return;

            /**
             * Format:
             * open / close arrays
             */
            if (
                symbolData.open &&
                symbolData.close
            ) {
                const openTimes = Array.isArray(
                    symbolData.open
                )
                    ? symbolData.open
                    : [symbolData.open];

                const closeTimes = Array.isArray(
                    symbolData.close
                )
                    ? symbolData.close
                    : [symbolData.close];

                tradingTimes[symbol] = {
                    isOpen:
                        openTimes.length > 0 &&
                        openTimes[0] !== '--',

                    openTime:
                        openTimes[0] || '',

                    closeTime:
                        closeTimes[0] || '',
                };

                return;
            }

            /**
             * Legacy format:
             * times array
             */
            if (
                Array.isArray(symbolData.times)
            ) {
                const firstSession =
                    symbolData.times[0];

                if (
                    firstSession?.open &&
                    firstSession?.close
                ) {
                    const openTime =
                        new Date(
                            firstSession.open
                        )
                            .toISOString()
                            .substring(11, 19);

                    const closeTime =
                        new Date(
                            firstSession.close
                        )
                            .toISOString()
                            .substring(11, 19);

                    tradingTimes[symbol] = {
                        isOpen: true,
                        openTime,
                        closeTime,
                    };
                }

                return;
            }

            /**
             * Already normalized format
             */
            if (
                'isOpen' in symbolData &&
                'openTime' in symbolData &&
                'closeTime' in symbolData
            ) {
                tradingTimes[symbol] = {
                    isOpen: Boolean(
                        symbolData.isOpen
                    ),

                    openTime:
                        symbolData.openTime || '',

                    closeTime:
                        symbolData.closeTime || '',
                };
            }
        });

        return tradingTimes;
    },
};

/**
 * Build SmartCharts Champion adapter.
 */
export function buildSmartchartsChampionAdapter(
    transport: TTransport,
    services: TServices,
    config: AdapterConfig = {}
): SmartchartsChampionAdapter {
    /**
     * Active subscriptions.
     */
    const subscriptions =
        new Map<string, () => void>();

    const debug = config.debug || false;

    /**
     * Logger.
     */
    const logger = {
        log: debug
            ? console.log.bind(
                  console,
                  '[SmartCharts]'
              )
            : () => {},

        warn: debug
            ? console.warn.bind(
                  console,
                  '[SmartCharts]'
              )
            : () => {},

        error: console.error.bind(
            console,
            '[SmartCharts]'
        ),
    };

    const adapter: SmartchartsChampionAdapter = {
        transport,
        services,

        /**
         * Get historical quotes.
         */
        async getQuotes(
            request: TGetQuotesRequest
        ): Promise<TGetQuotesResult> {
            try {
                const apiRequest: any = {
                    ticks_history:
                        request.symbol,

                    end:
                        request.end ||
                        'latest',

                    count:
                        request.count ||
                        1000,

                    adjust_start_time: 1,
                };

                /**
                 * Tick chart.
                 */
                if (request.granularity === 0) {
                    apiRequest.style = 'ticks';
                }

                /**
                 * Candle chart.
                 */
                else {
                    apiRequest.style = 'candles';

                    apiRequest.granularity =
                        request.granularity;
                }

                /**
                 * Start time.
                 */
                if (request.start) {
                    apiRequest.start =
                        request.start;

                    delete apiRequest.count;
                }

                if (debug) {
                    logger.log(
                        'getQuotes request:',
                        apiRequest
                    );
                }

                const response =
                    await transport.send(
                        apiRequest
                    );

                if (debug) {
                    logger.log(
                        'getQuotes response:',
                        response
                    );
                }

                return transformations.toTGetQuotesResult(
                    response,
                    request.granularity
                );
            } catch (error) {
                logger.error(
                    'Error in getQuotes:',
                    error
                );

                return {
                    quotes: [],

                    meta: {
                        symbol:
                            request.symbol,

                        granularity:
                            request.granularity,
                    },
                };
            }
        },

        /**
         * Subscribe to live quote updates.
         *
         * IMPORTANT:
         * - Tick charts use `ticks`
         * - Candle charts use `ticks_history`
         *   with subscription
         */
        subscribeQuotes(
            request: TGetQuotesRequest,
            callback: TSubscriptionCallback
        ): TUnsubscribeFunction {
            const subscriptionKey =
                `${request.symbol}-${request.granularity}`;

            /**
             * Remove an existing subscription
             * for the same symbol/granularity.
             */
            const existingSubscription =
                subscriptions.get(
                    subscriptionKey
                );

            if (existingSubscription) {
                existingSubscription();
            }

            /**
             * Tick subscription.
             */
            const apiRequest: any =
                request.granularity === 0
                    ? {
                          ticks:
                              request.symbol,

                          subscribe: 1,
                      }
                    : {
                          ticks_history:
                              request.symbol,

                          subscribe: 1,

                          end: 'latest',

                          count: 1,

                          style: 'candles',

                          granularity:
                              request.granularity,
                      };

            try {
                if (debug) {
                    logger.log(
                        'subscribeQuotes request:',
                        apiRequest
                    );
                }

                const subscriptionId =
                    transport.subscribe(
                        apiRequest,
                        (response: any) => {
                            try {
                                if (debug) {
                                    logger.log(
                                        'stream response:',
                                        response
                                    );
                                }

                                const quote =
                                    transformations.toTQuoteFromStream(
                                        response,
                                        request.granularity
                                    );

                                /**
                                 * Ignore unrelated
                                 * WebSocket messages.
                                 */
                                if (
                                    !quote ||
                                    quote.Close ===
                                        undefined
                                ) {
                                    return;
                                }

                                callback(quote);
                            } catch (error) {
                                logger.error(
                                    'Error transforming stream message:',
                                    error
                                );
                            }
                        }
                    );

                /**
                 * Unsubscribe function.
                 */
                const unsubscribe =
                    () => {
                        try {
                            transport.unsubscribe(
                                subscriptionId
                            );
                        } catch (error) {
                            logger.error(
                                'Error unsubscribing:',
                                error
                            );
                        }

                        subscriptions.delete(
                            subscriptionKey
                        );
                    };

                subscriptions.set(
                    subscriptionKey,
                    unsubscribe
                );

                return unsubscribe;
            } catch (error) {
                logger.error(
                    'Error in subscribeQuotes:',
                    error
                );

                return () => {};
            }
        },

        /**
         * Unsubscribe from live quotes.
         */
        unsubscribeQuotes(
            request: TGetQuotesRequest
        ): void {
            const subscriptionKey =
                `${request.symbol}-${request.granularity}`;

            const unsubscribe =
                subscriptions.get(
                    subscriptionKey
                );

            if (unsubscribe) {
                unsubscribe();
            } else if (debug) {
                logger.warn(
                    'No active subscription found for:',
                    subscriptionKey
                );
            }
        },

        /**
         * Get chart reference data.
         */
        async getChartData(): Promise<{
            activeSymbols: ActiveSymbols;
            tradingTimes: TradingTimesMap;
        }> {
            try {
                const [
                    activeSymbolsData,
                    tradingTimesData,
                ] = await Promise.all([
                    services.getActiveSymbols(),
                    services.getTradingTimes(),
                ]);

                const activeSymbols =
                    transformations.toActiveSymbols(
                        activeSymbolsData
                    );

                const tradingTimes =
                    transformations.toTradingTimesMap(
                        tradingTimesData
                    );

                return {
                    activeSymbols,
                    tradingTimes,
                };
            } catch (error) {
                logger.error(
                    'Error in getChartData:',
                    error
                );

                return {
                    activeSymbols:
                        [] as ActiveSymbols,

                    tradingTimes:
                        {} as TradingTimesMap,
                };
            }
        },
    };

    return adapter;
}

/**
 * Export types for convenience.
 */
export type {
    SmartchartsChampionAdapter,
    TGetQuotesRequest,
    TGetQuotesResult,
} from './types';

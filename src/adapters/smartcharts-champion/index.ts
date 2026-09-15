/**
 * SmartCharts Champion Adapter
 *
 * Adapter Deriv API -> @deriv-com/smartcharts-champion
 */

import type { ActiveSymbol } from '@deriv-com/smartcharts-champion';

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
 * ---------------------------------------------------------
 * Transformations
 * ---------------------------------------------------------
 */

const transformations = {
    /**
     * Transform live Deriv response into the format
     * expected by SmartCharts.
     */
    toTQuoteFromStream(
        message: any,
        granularity: TGranularity
    ): TQuote | null {
        if (!message) {
            return null;
        }

        /**
         * -------------------------------------------------
         * Live tick
         * -------------------------------------------------
         */
        if (message.tick) {
            const tick = message.tick;

            if (
                tick.quote === undefined ||
                tick.epoch === undefined
            ) {
                return null;
            }

            return {
                Date: String(tick.epoch),
                Close: Number(tick.quote),
                tick,
                DT: new Date(
                    Number(tick.epoch) * 1000
                ),
            };
        }

        /**
         * -------------------------------------------------
         * Live OHLC candle
         * -------------------------------------------------
         */
        if (message.ohlc) {
            const ohlc = message.ohlc;

            if (
                ohlc.close === undefined ||
                ohlc.epoch === undefined
            ) {
                return null;
            }

            return {
                Date: String(ohlc.epoch),
                Open: Number(ohlc.open),
                High: Number(ohlc.high),
                Low: Number(ohlc.low),
                Close: Number(ohlc.close),
                ohlc,
                DT: new Date(
                    Number(ohlc.epoch) * 1000
                ),
            };
        }

        /**
         * -------------------------------------------------
         * Direct quote fallback
         * -------------------------------------------------
         */
        if (
            message.epoch !== undefined &&
            (
                message.quote !== undefined ||
                message.price !== undefined
            )
        ) {
            const quote =
                message.quote !== undefined
                    ? message.quote
                    : message.price;

            const numericQuote = Number(quote);

            if (!Number.isFinite(numericQuote)) {
                return null;
            }

            return {
                Date: String(message.epoch),
                Close: numericQuote,
                DT: new Date(
                    Number(message.epoch) * 1000
                ),
            };
        }

        return null;
    },

    /**
     * ---------------------------------------------------------
     * Active symbols
     * ---------------------------------------------------------
     */
    toActiveSymbols(
        activeSymbolsData: any[]
    ): ActiveSymbol[] {
        if (!Array.isArray(activeSymbolsData)) {
            return [];
        }

        const symbols: ActiveSymbol[] = [];

        for (const item of activeSymbolsData) {
            if (!item) {
                continue;
            }

            const symbol =
                item.underlying_symbol ||
                item.symbol;

            if (!symbol) {
                continue;
            }

            symbols.push({
                display_name:
                    item.display_name || symbol,

                market:
                    item.market || '',

                market_display_name:
                    item.market_display_name || '',

                subgroup:
                    item.subgroup || '',

                subgroup_display_name:
                    item.subgroup_display_name || '',

                submarket:
                    item.submarket || '',

                submarket_display_name:
                    item.submarket_display_name || '',

                symbol,

                symbol_type:
                    item.symbol_type || '',

                pip:
                    Number(
                        item.pip ??
                        item.pip_size ??
                        0.01
                    ),

                exchange_is_open:
                    Number(
                        item.exchange_is_open ?? 0
                    ),

                is_trading_suspended:
                    Number(
                        item.is_trading_suspended ?? 0
                    ),

                delay_amount:
                    item.delay_amount,
            });
        }

        return symbols;
    },

    /**
     * ---------------------------------------------------------
     * Trading times
     * ---------------------------------------------------------
     */
    toTradingTimesMap(
        data: any
    ): TradingTimesMap {
        const result: TradingTimesMap = {};

        if (
            !data ||
            typeof data !== 'object'
        ) {
            return result;
        }

        const source =
            data.trading_times ||
            data;

        for (
            const symbol of Object.keys(source)
        ) {
            const value =
                source[symbol];

            if (!value) {
                continue;
            }

            if (
                typeof value === 'object' &&
                'isOpen' in value &&
                'openTime' in value &&
                'closeTime' in value
            ) {
                result[symbol] = {
                    isOpen:
                        Boolean(
                            value.isOpen
                        ),

                    openTime:
                        value.openTime || '',

                    closeTime:
                        value.closeTime || '',
                };
            }
        }

        return result;
    },
};

/**
 * ---------------------------------------------------------
 * Adapter
 * ---------------------------------------------------------
 */

export function buildSmartchartsChampionAdapter(
    transport: TTransport,
    services: TServices,
    config: AdapterConfig = {}
): SmartchartsChampionAdapter {
    const subscriptions =
        new Map<
            string,
            TUnsubscribeFunction
        >();

    const debug =
        config.debug === true;

    const log = (...args: any[]) => {
        if (debug) {
            console.log(
                '[SmartCharts]',
                ...args
            );
        }
    };

    const warn = (...args: any[]) => {
        if (debug) {
            console.warn(
                '[SmartCharts]',
                ...args
            );
        }
    };

    const error = (...args: any[]) => {
        console.error(
            '[SmartCharts]',
            ...args
        );
    };

    const adapter:
        SmartchartsChampionAdapter = {

        transport,
        services,

        /**
         * -----------------------------------------------------
         * HISTORICAL DATA
         * -----------------------------------------------------
         *
         * SmartCharts expects:
         *
         * ticks:
         * {
         *   history: {
         *     times: [],
         *     prices: []
         *   }
         * }
         *
         * candles:
         * {
         *   candles: []
         * }
         */
        async getQuotes(
            request: TGetQuotesRequest
        ): Promise<any> {

            try {
                /**
                 * Respect SmartCharts style when supplied.
                 */
                const style =
                    (request as any).style ??
                    (
                        request.granularity === 0
                            ? 'ticks'
                            : 'candles'
                    );

                const apiRequest: any = {
                    ticks_history:
                        request.symbol,

                    end:
                        request.end ??
                        'latest',

                    adjust_start_time: 1,

                    style,
                };

                /**
                 * Count
                 */
                if (
                    request.count !== undefined
                ) {
                    apiRequest.count =
                        request.count;
                }

                /**
                 * Explicit start
                 */
                if (
                    request.start !== undefined
                ) {
                    apiRequest.start =
                        request.start;

                    delete apiRequest.count;
                }

                /**
                 * Candle granularity
                 */
                if (
                    style === 'candles'
                ) {
                    apiRequest.granularity =
                        request.granularity;
                }

                log(
                    'GET QUOTES REQUEST',
                    apiRequest
                );

                const response =
                    await transport.send(
                        apiRequest
                    );

                log(
                    'GET QUOTES RESPONSE',
                    response
                );

                /**
                 * IMPORTANT:
                 *
                 * Return the ORIGINAL Deriv
                 * response.
                 */
                return response;

            } catch (err) {

                error(
                    'getQuotes failed:',
                    err
                );

                /**
                 * Empty fallback for ticks.
                 */
                if (
                    (
                        request as any
                    ).style === 'ticks' ||
                    request.granularity === 0
                ) {
                    return {
                        history: {
                            times: [],
                            prices: [],
                        },
                    };
                }

                /**
                 * Empty fallback for candles.
                 */
                return {
                    candles: [],
                };
            }
        },

        /**
         * -----------------------------------------------------
         * LIVE QUOTES
         * -----------------------------------------------------
         */
        subscribeQuotes(
            request: TGetQuotesRequest,
            callback: TSubscriptionCallback
        ): TUnsubscribeFunction {

            const key =
                `${request.symbol}-${request.granularity}`;

            /**
             * Remove previous subscription.
             */
            const previous =
                subscriptions.get(key);

            if (previous) {
                previous();
            }

            /**
             * -------------------------------------------------
             * Tick stream
             * -------------------------------------------------
             */
            const apiRequest: any =
                request.granularity === 0
                    ? {
                        ticks:
                            request.symbol,

                        subscribe: 1,
                    }

                    /**
                     * -------------------------------------------------
                     * Candle stream
                     * -------------------------------------------------
                     */
                    : {
                        ticks_history:
                            request.symbol,

                        end:
                            'latest',

                        style:
                            'candles',

                        granularity:
                            request.granularity,

                        subscribe: 1,
                    };

            try {

                log(
                    'SUBSCRIBE REQUEST',
                    apiRequest
                );

                const subscriptionId =
                    transport.subscribe(
                        apiRequest,
                        (
                            response: any
                        ) => {

                            try {

                                log(
                                    'STREAM RESPONSE',
                                    response
                                );

                                /**
                                 * Convert Deriv response
                                 * into SmartCharts quote.
                                 */
                                const quote =
                                    transformations
                                        .toTQuoteFromStream(
                                            response,
                                            request.granularity
                                        );

                                if (!quote) {
                                    return;
                                }

                                if (
                                    !Number.isFinite(
                                        quote.Close
                                    )
                                ) {
                                    return;
                                }

                                log(
                                    'QUOTE',
                                    quote
                                );

                                callback(
                                    quote
                                );

                            } catch (err) {

                                error(
                                    'Stream transformation failed:',
                                    err
                                );
                            }
                        }
                    );

                const unsubscribe =
                    () => {

                        try {

                            log(
                                'UNSUBSCRIBE',
                                key
                            );

                            transport.unsubscribe(
                                subscriptionId
                            );

                        } catch (err) {

                            error(
                                'unsubscribe failed:',
                                err
                            );
                        }

                        subscriptions.delete(
                            key
                        );
                    };

                subscriptions.set(
                    key,
                    unsubscribe
                );

                return unsubscribe;

            } catch (err) {

                error(
                    'subscribeQuotes failed:',
                    err
                );

                return () => {};
            }
        },

        /**
         * -----------------------------------------------------
         * UNSUBSCRIBE
         * -----------------------------------------------------
         */
        unsubscribeQuotes(
            request: TGetQuotesRequest
        ): void {

            const key =
                `${request.symbol}-${request.granularity}`;

            const unsubscribe =
                subscriptions.get(key);

            if (unsubscribe) {

                unsubscribe();

            } else {

                warn(
                    'No subscription:',
                    key
                );
            }
        },

        /**
         * -----------------------------------------------------
         * CHART DATA
         * -----------------------------------------------------
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

                log(
                    'ACTIVE SYMBOLS RAW',
                    activeSymbolsData
                );

                log(
                    'TRADING TIMES RAW',
                    tradingTimesData
                );

                const activeSymbols =
                    transformations
                        .toActiveSymbols(
                            activeSymbolsData
                        );

                const tradingTimes =
                    transformations
                        .toTradingTimesMap(
                            tradingTimesData
                        );

                log(
                    'ACTIVE SYMBOLS',
                    activeSymbols
                );

                log(
                    'TRADING TIMES',
                    tradingTimes
                );

                return {
                    activeSymbols,
                    tradingTimes,
                };

            } catch (err) {

                error(
                    'getChartData failed:',
                    err
                );

                return {
                    activeSymbols: [],
                    tradingTimes: {},
                };
            }
        },
    };

    return adapter;
}

/**
 * ---------------------------------------------------------
 * Convenience exports
 * ---------------------------------------------------------
 */

export type {
    SmartchartsChampionAdapter,
    TGetQuotesRequest,
    TGetQuotesResult,
} from './types';

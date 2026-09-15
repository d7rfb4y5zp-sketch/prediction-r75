/**
 * SmartCharts Champion Adapter
 *
 * Deriv API -> @deriv-com/smartcharts-champion
 */

import type { ActiveSymbol } from '@deriv-com/smartcharts-champion';

import type {
    ActiveSymbols,
    AdapterConfig,
    SmartchartsChampionAdapter,
    TGetQuotesRequest,
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
     * Convert a live Deriv message to our internal TQuote.
     */
    toTQuoteFromStream(
        message: any,
        granularity: TGranularity
    ): TQuote | null {
        if (!message) {
            return null;
        }

        // Live tick
        if (message.tick) {
            const tick = message.tick;

            if (
                tick.quote === undefined ||
                tick.epoch === undefined
            ) {
                return null;
            }

            const quote = Number(tick.quote);
            const epoch = Number(tick.epoch);

            if (!Number.isFinite(quote) || !Number.isFinite(epoch)) {
                return null;
            }

            return {
                Date: String(epoch),
                Close: quote,
                tick,
                DT: new Date(epoch * 1000),
            };
        }

        // Live candle / OHLC
        if (message.ohlc) {
            const ohlc = message.ohlc;

            if (
                ohlc.close === undefined ||
                ohlc.epoch === undefined
            ) {
                return null;
            }

            const close = Number(ohlc.close);
            const epoch = Number(ohlc.epoch);

            if (!Number.isFinite(close) || !Number.isFinite(epoch)) {
                return null;
            }

            return {
                Date: String(epoch),
                Open:
                    ohlc.open !== undefined
                        ? Number(ohlc.open)
                        : close,
                High:
                    ohlc.high !== undefined
                        ? Number(ohlc.high)
                        : close,
                Low:
                    ohlc.low !== undefined
                        ? Number(ohlc.low)
                        : close,
                Close: close,
                ohlc,
                DT: new Date(epoch * 1000),
            };
        }

        // Direct quote fallback
        if (
            message.epoch !== undefined &&
            (
                message.quote !== undefined ||
                message.price !== undefined
            )
        ) {
            const value =
                message.quote !== undefined
                    ? message.quote
                    : message.price;

            const quote = Number(value);
            const epoch = Number(message.epoch);

            if (
                !Number.isFinite(quote) ||
                !Number.isFinite(epoch)
            ) {
                return null;
            }

            return {
                Date: String(epoch),
                Close: quote,
                DT: new Date(epoch * 1000),
            };
        }

        return null;
    },

    /**
     * Convert Deriv history response to TQuote[].
     */
    toQuotesFromHistory(
        response: any,
        style: 'ticks' | 'candles'
    ): TQuote[] {
        if (!response) {
            return [];
        }

        /**
         * -------------------------------------------------
         * TICKS
         * -------------------------------------------------
         */
        if (style === 'ticks') {
            const prices =
                response?.history?.prices ?? [];

            const times =
                response?.history?.times ?? [];

            if (
                !Array.isArray(prices) ||
                !Array.isArray(times)
            ) {
                return [];
            }

            const quotes: TQuote[] = [];

            const length =
                Math.min(
                    prices.length,
                    times.length
                );

            for (let i = 0; i < length; i += 1) {
                const price = Number(prices[i]);
                const epoch = Number(times[i]);

                if (
                    !Number.isFinite(price) ||
                    !Number.isFinite(epoch)
                ) {
                    continue;
                }

                quotes.push({
                    Date: String(epoch),
                    Close: price,
                    DT: new Date(epoch * 1000),
                });
            }

            return quotes;
        }

        /**
         * -------------------------------------------------
         * CANDLES
         * -------------------------------------------------
         */
        const candles =
            response?.candles ?? [];

        if (!Array.isArray(candles)) {
            return [];
        }

        return candles
            .map((candle: any): TQuote | null => {
                if (
                    candle?.epoch === undefined ||
                    candle?.close === undefined
                ) {
                    return null;
                }

                const epoch =
                    Number(candle.epoch);

                const close =
                    Number(candle.close);

                if (
                    !Number.isFinite(epoch) ||
                    !Number.isFinite(close)
                ) {
                    return null;
                }

                const open =
                    candle.open !== undefined
                        ? Number(candle.open)
                        : close;

                const high =
                    candle.high !== undefined
                        ? Number(candle.high)
                        : close;

                const low =
                    candle.low !== undefined
                        ? Number(candle.low)
                        : close;

                return {
                    Date: String(epoch),
                    Open: Number.isFinite(open)
                        ? open
                        : close,
                    High: Number.isFinite(high)
                        ? high
                        : close,
                    Low: Number.isFinite(low)
                        ? low
                        : close,
                    Close: close,
                    ohlc: candle,
                    DT: new Date(epoch * 1000),
                };
            })
            .filter(
                (quote): quote is TQuote =>
                    quote !== null
            );
    },

    /**
     * Convert active_symbols response.
     */
    toActiveSymbols(
        activeSymbolsData: any
    ): ActiveSymbol[] {
        const source =
            Array.isArray(activeSymbolsData)
                ? activeSymbolsData
                : Array.isArray(
                      activeSymbolsData?.active_symbols
                  )
                ? activeSymbolsData.active_symbols
                : [];

        const symbols: ActiveSymbol[] = [];

        for (const item of source) {
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
     * Convert trading times.
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

        for (const symbol of Object.keys(source)) {
            const value =
                source[symbol];

            if (!value) {
                continue;
            }

            /**
             * Already normalized format.
             */
            if (
                typeof value === 'object' &&
                'isOpen' in value &&
                'openTime' in value &&
                'closeTime' in value
            ) {
                result[symbol] = {
                    isOpen:
                        Boolean(value.isOpen),

                    openTime:
                        String(
                            value.openTime ?? ''
                        ),

                    closeTime:
                        String(
                            value.closeTime ?? ''
                        ),
                };

                continue;
            }

            /**
             * Deriv trading_times can contain
             * market/submarket/symbol structures.
             *
             * We only add entries when a usable
             * open/close structure is available.
             */
            if (
                typeof value === 'object'
            ) {
                const openTime =
                    value.openTime ??
                    value.open_time ??
                    '';

                const closeTime =
                    value.closeTime ??
                    value.close_time ??
                    '';

                if (
                    openTime !== '' ||
                    closeTime !== ''
                ) {
                    result[symbol] = {
                        isOpen:
                            Boolean(
                                value.isOpen ??
                                value.is_open ??
                                true
                            ),

                        openTime:
                            String(openTime),

                        closeTime:
                            String(closeTime),
                    };
                }
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
         * -------------------------------------------------
         * HISTORICAL DATA
         * -------------------------------------------------
         */
        async getQuotes(
            request: TGetQuotesRequest
        ): Promise<any> {
            try {
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
                 * Count is used when no explicit
                 * start is supplied.
                 */
                if (
                    request.count !== undefined &&
                    request.start === undefined
                ) {
                    apiRequest.count =
                        request.count;
                }

                /**
                 * Explicit start/end request.
                 */
                if (
                    request.start !== undefined
                ) {
                    apiRequest.start =
                        request.start;

                    delete apiRequest.count;
                }

                /**
                 * Candles require granularity.
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
                 * Transform Deriv response into
                 * the internal { quotes: TQuote[] }
                 * format expected by the hook.
                 */
                const quotes =
                    transformations.toQuotesFromHistory(
                        response,
                        style === 'candles'
                            ? 'candles'
                            : 'ticks'
                    );

                log(
                    'TRANSFORMED QUOTES',
                    quotes.length
                );

                return {
                    quotes,

                    meta: {
                        symbol:
                            request.symbol,

                        granularity:
                            request.granularity,
                    },
                };

            } catch (err) {
                error(
                    'getQuotes failed:',
                    err
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
         * -------------------------------------------------
         * LIVE QUOTES
         * -------------------------------------------------
         */
        subscribeQuotes(
            request: TGetQuotesRequest,
            callback: TSubscriptionCallback
        ): TUnsubscribeFunction {

            const key =
                `${request.symbol}-${request.granularity}`;

            /**
             * Remove previous subscription
             * for the same symbol/granularity.
             */
            const previous =
                subscriptions.get(key);

            if (previous) {
                try {
                    previous();
                } catch (err) {
                    error(
                        'Previous unsubscribe failed:',
                        err
                    );
                }
            }

            /**
             * Tick stream.
             *
             * IMPORTANT:
             * ticks_history is NOT used here.
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
                        (response: any) => {
                            try {
                                log(
                                    'STREAM RESPONSE',
                                    response
                                );

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
         * -------------------------------------------------
         * UNSUBSCRIBE
         * -------------------------------------------------
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
         * -------------------------------------------------
         * CHART DATA
         * -------------------------------------------------
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
                    transformations.toActiveSymbols(
                        activeSymbolsData
                    );

                const tradingTimes =
                    transformations.toTradingTimesMap(
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
} from './types';

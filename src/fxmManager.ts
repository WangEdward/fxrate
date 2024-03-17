/* eslint-disable @typescript-eslint/indent */
/* eslint-disable indent */

import { router, response, request, handler } from 'handlers.js';
import fxManager from './fxm/fxManager';
import { FXRate, currency } from './types';

import { round } from 'mathjs';

import packageJson from '../package.json';
import process from 'node:process';

const useBasic = (response: response<any>): void => {
    response.status = 200;
    response.headers.set('Date', new Date().toUTCString());
};

const useJson = (response: response<any>): void => {
    useBasic(response);
    response.headers.set('Content-type', 'application/json; charset=utf-8');
};

const getConvert = async (
    from: currency,
    to: currency,
    type: string,
    fxManager: fxManager,
    request: request<any>,
    amount: number = 100,
) => {
    let answer = fxManager.convert(
        from,
        to,
        type as 'cash' | 'remit' | 'middle',
        Number(request.query.get('amount')) || amount || 100,
        request.query.has('reverse'),
    );
    answer =
        Number(request.query.get('precision')) !== -1
            ? round(answer, Number(request.query.get('precision')) || 5)
            : answer;
    return Number(answer.toString()) || answer.toString();
};

const getDetails = async (
    from: currency,
    to: currency,
    fxManager: fxManager,
    request: request<any>,
) => {
    const result = {
        updated: fxManager.getUpdatedDate(from, to).toUTCString(),
    };
    for (const type of ['cash', 'remit', 'middle']) {
        try {
            result[type] = await getConvert(from, to, type, fxManager, request);
        } catch (e) {
            result[type] = false;
        }
    }
    return result;
};

class fxmManager extends router {
    private fxms: {
        [source: string]: fxManager;
    } = {};
    private fxmStatus: {
        [source: string]: 'ready' | 'pending';
    } = {};

    private fxRateGetter: {
        [source: string]: (fxmManager?: fxmManager) => Promise<FXRate[]>;
    } = {};

    constructor(sources: { [source: string]: () => Promise<FXRate[]> }) {
        super();
        for (const source in sources) {
            this.register(source, sources[source]);
        }

        this.binding(
            '/info',
            this.create('GET', async () => {
                return {
                    status: 'ok',
                    sources: Object.keys(this.fxms),
                    version: `${packageJson.name}/${packageJson.version}`,
                    apiVersion: 'v1',
                    environment: process.env.NODE_ENV || 'development',
                };
            }),
        );
    }

    public log(str: string) {
        setTimeout(() => {
            console.log(`[${new Date().toUTCString()}] [fxmManager] ${str}`);
        }, 0);
    }

    public has(source: string): boolean {
        return this.fxms[source] !== undefined;
    }

    public async updateFXManager(source: string): Promise<void> {
        if (!this.has(source)) {
            throw new Error('Source not found');
        }
        this.log(`${source} is updating...`);
        const fxRates = await this.fxRateGetter[source](this);
        fxRates.forEach((f) => this.fxms[source].update(f));
        this.fxmStatus[source] = 'ready';
        this.log(`${source} is updated, now is ready.`);
        return;
    }

    public async requestFXManager(source: string): Promise<fxManager> {
        if (this.fxmStatus[source] === 'pending') {
            await this.updateFXManager(source);
        }
        return this.fxms[source];
    }

    public register(source: string, getter: () => Promise<FXRate[]>): void {
        this.fxms[source] = new fxManager([]);
        this.fxRateGetter[source] = getter;
        this.fxmStatus[source] = 'pending';
        this.mountFXMRouter(source);
        this.log(`Registered ${source}.`);
        setInterval(() => this.updateFXManager(source), 1000 * 60 * 30);
    }

    private mountFXMRouter(source: string): void {
        this.use([this.getFXMRouter(source)], `/${source}/(.*)`);
    }

    private getFXMRouter(source: string): router {
        const fxmRouter = new router();

        fxmRouter.binding(
            '/:from',
            new handler('GET', [
                async (request, response) => {
                    const { from } = request.params;
                    if (
                        !(await this.requestFXManager(source)).fxRateList[from]
                    ) {
                        if (from != source) {
                            response.status = 404;
                            response.body = '404 Not Found';
                            useBasic(response);
                            return response;
                        }
                        response.body = JSON.stringify({
                            status: 'ok',
                            source,
                            currency: Object.keys(
                                (await this.requestFXManager(source))
                                    .fxRateList,
                            ),
                            date: new Date().toUTCString(),
                        });
                        useJson(response);
                        return response;
                    }
                    const result: {
                        [to in keyof currency]: {
                            [type in string]: string;
                        };
                    } = {} as any;
                    for (const to in (await this.requestFXManager(source))
                        .fxRateList[from]) {
                        if (to == from) continue;
                        result[to] = await getDetails(
                            from as unknown as currency,
                            to as unknown as currency,
                            await this.requestFXManager(source),
                            request,
                        );
                    }
                    response.body = JSON.stringify(result);
                    useJson(response);
                    return response;
                },
            ]),
        );

        fxmRouter.binding(
            '/:from/:to',
            new handler('GET', [
                async (request, response) => {
                    const { from, to } = request.params;
                    const result = await getDetails(
                        from as unknown as currency,
                        to as unknown as currency,
                        await this.requestFXManager(source),
                        request,
                    );
                    response.body = JSON.stringify(result);
                    useJson(response);
                    response.headers.set(
                        'Date',
                        (await this.requestFXManager(source))
                            .getUpdatedDate(
                                from as unknown as currency,
                                to as unknown as currency,
                            )
                            .toUTCString(),
                    );
                    return response;
                },
            ]),
        );

        fxmRouter.binding(
            '/:from/:to/:type',
            new handler('GET', [
                async (request, response) => {
                    const { from, to, type } = request.params;
                    const result = await getConvert(
                        from as unknown as currency,
                        to as unknown as currency,
                        type,
                        await this.requestFXManager(source),
                        request,
                    );
                    response.body = result.toString();
                    useBasic(response);
                    response.headers.set(
                        'Date',
                        (await this.requestFXManager(source))
                            .getUpdatedDate(
                                from as unknown as currency.unknown,
                                to as unknown as currency.unknown,
                            )
                            .toUTCString(),
                    );
                    return response;
                },
            ]),
        );

        fxmRouter.binding(
            '/:from/:to/:type/:amount',
            new handler('GET', [
                async (request, response) => {
                    const { from, to, type, amount } = request.params;
                    const result = await getConvert(
                        from as unknown as currency,
                        to as unknown as currency,
                        type,
                        await this.requestFXManager(source),
                        request,
                        Number(amount),
                    );
                    response.body = result.toString();
                    useBasic(response);
                    response.headers.set(
                        'Date',
                        (await this.requestFXManager(source))
                            .getUpdatedDate(
                                from as unknown as currency.unknown,
                                to as unknown as currency.unknown,
                            )
                            .toUTCString(),
                    );
                    return response;
                },
            ]),
        );

        return fxmRouter;
    }
}

export default fxmManager;

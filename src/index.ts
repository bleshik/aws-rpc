import isNumber = require('lodash/isNumber');
import { Lambda } from 'aws-sdk';
import { Context, Callback } from 'aws-lambda';
import { context } from 'ctx4node';
const jayson = require('jayson');

export interface RpcRequest {
    method: string;
    args: any[];
}

export interface RpcResult {
    result?: any;
    error?: any;
}

// TODO: make it possible to specify a chain of filters, not just a single 1
export type RpcRequestFilter = (r: RpcRequest) => Promise<RpcRequest>;
export type RpcResultFilter = (r: RpcResult) => Promise<RpcResult>;

export function runService(
    obj: object,
    port: number,
    requestFilter: RpcRequestFilter = (r) => Promise.resolve(r),
    resultFilter: RpcResultFilter = (r) => Promise.resolve(r),
) {
    const server = jayson.server({
        handle: (request: RpcRequest, cb: (err: any, value: RpcResult) => void) => {
            return context.runWithNew(() => {
                return context.bind(requestFilter)(
                    request,
                ).then((r: RpcRequest) => {
                    return handleRequest(obj, r).then(context.bind(resultFilter)).
                        then((newResult: RpcResult) => cb(null, newResult));
                });
            });
        }
    }).http().listen(port);
    console.log("Running service locally on port " + server.address().port);
    return server;
}

export function lambdaHandler(
    obj: object,
    requestFilter: RpcRequestFilter = (r) => Promise.resolve(r),
    resultFilter: RpcResultFilter = (r) => Promise.resolve(r),
) {
    return function(event: RpcRequest, c: Context | null, callback: Callback) {
        return context.runWithNew(() => {
            context.bind(requestFilter)(event).then((request: RpcRequest) => {
                return handleRequest(obj, request).then(context.bind(resultFilter)).
                    then((newValue: RpcResult) => {
                        if (newValue.error) {
                            console.error(newValue.error);
                        }
                        callback(newValue.error, newValue);
                    }).
                    catch((err: any) => {
                        console.error(err);
                        callback(err, undefined);
                    });
            });
        });
    };
}

export function createClient<T>(
    conf: number | Lambda.Types.ClientConfiguration & {FunctionName: string},
    ...methods: (keyof T)[]
): Promise<T & Client> {
    return isNumber(conf) ? createLocalClient(conf as number, methods) : createLambdaClient(conf as any, methods);
}

export interface Client {
    end(): void;
}

function handleRequest(obj: object, request: RpcRequest): Promise<RpcResult> {
    return new Promise((resolve, reject) => {
        try {
            const method = obj[request.method] as Function | undefined;
            if (method) {
                resolve(method.apply(obj, request.args));
            } else {
                // if no method provided, assume it's just a "ping" request
                resolve({ result: "OK" });
            }
        } catch (e) {
            reject({ error: e });
        }
    }).
    then((val) => ({ result: val })).
    catch((e) => ({ error: e }));
}

type ClientCallback = (err: any, data: Lambda.Types.InvocationResponse) => void;

type Invocable = { invoke: (request: Lambda.Types.InvocationRequest, callback?: ClientCallback) => void };

function doInvoke(client: Invocable, name: string, method: string, args: any[]) {
    return new Promise((resolve, reject) => {
        client.invoke({
            FunctionName: name,
            InvocationType: 'RequestResponse',
            Payload: JSON.stringify({ method, args })
        }, (invError: any, data: Lambda.Types.InvocationResponse) => {
            if (invError) {
                reject(invError);
            } else {
                if (data.Payload) {
                    const { result, error } = JSON.parse(data.Payload as string) as RpcResult;
                    if (error) {
                        reject(error);
                    } else {
                        resolve(result);
                    }
                } else {
                    resolve();
                }
            }
        });
    });
}

function createLambdaClient<T>(
    conf: Lambda.Types.ClientConfiguration & {FunctionName: string},
    methods: (keyof T)[]
): Promise<T & Client> {
    const lambda = new Lambda(conf);
    const { FunctionName } = conf;
    return Promise.resolve(doCreateClient<T>(FunctionName, lambda, methods as string[]));
}

function createLocalClient<T>(port: number, methods: (keyof T)[]): Promise<T & Client> {
    return new Promise((resolve, reject) => {
        const j = jayson.client.http({port});
        const invocable: Invocable = {
            invoke: (request: Lambda.Types.InvocationRequest, callback?: ClientCallback) => {
                j.request(
                    'handle',
                    JSON.parse(request.Payload as string) as RpcRequest,
                    (err: any, res: { error: any, result: RpcResult }) => {
                        if (callback) {
                            callback(err || res.error, { Payload: JSON.stringify(res.result) });
                        }
                });
            }
        };
        resolve(doCreateClient<T>(port.toString(), invocable, methods as string[]));
    });
}

function doCreateClient<T>(
    name: string,
    invocable: Invocable,
    methods: string[],
    end: () => void = () => undefined
) {
    const wrapped = methods.reduce((o, k) => {
        o[k] = function(this: any, ...args: any[]) {
            return doInvoke(invocable, name, k, args);
        };
        return o;
    }, {});
    wrapped['end'] = end;
    return wrapped as T & Client;
}

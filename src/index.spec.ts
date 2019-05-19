import { runService, createClient, lambdaHandler } from './index';

interface TestService {
    test(): Promise<string>;
}

class TestServiceImpl implements TestService {
    private readonly field: string = "42";
    test(): Promise<string> {
        return Promise.resolve(this.field);
    }
}

it('runService', async () => {
    const testService = new TestServiceImpl();
    const server = runService(testService, 0);
    const client = await createClient<TestService>(server.address().port, "test");
    const result = await client.test();
    server.close();
    client.end();
    expect(result).toEqual("42");
});

it('lambdaHandler', async () => {
    const testService = new TestServiceImpl();
    const handler = lambdaHandler(testService);
    const result = await new Promise((resolve, reject) => {
        handler({ method: "test", args: [] }, null, (error: any, value: any) => resolve(value.result));
    });
    expect(result).toEqual("42");
});

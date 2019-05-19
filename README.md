[![Build Status](https://travis-ci.org/bleshik/aws-rpc.svg?branch=master)](https://travis-ci.org/bleshik/aws-rpc)
# aws-rpc
This is the easiest way to expose any plain old JS object as AWS Lambda.

## How to use it
Suppose you have an object that you want to expose. Here is an example interface of it:
```
export interface TestService {
    test(): Promise<string>;
}
```

Here is its implementation:
```
import { TestService } from './TestService';

export class TestServiceImpl implements TestService {
    private readonly field: string = "42";
    test(): Promise<string> {
        return Promise.resolve(this.field);
    }
}
```

First, you will need to make a handler for your AWS Lambda:
```
import { lambdaHandler } from 'aws-rpc';
import { TestServiceImpl } from './TestServiceImpl';

export const handler = lambdaHandler(new TestServiceImpl());
```

Now, you can just deploy "handler" as AWS Lambda. Here is how you invoke its methods:
```
import { TestService } from './TestService';

const client = await createClient<TestService>("LambdaName", "test");
console.log(await client.test()); // 42
```

## How can I test it locally?

You can expose the object as a http service:
```
import { runService } from 'aws-rpc';
import { TestServiceImpl } from './TestServiceImpl';

export const handler = runService(new TestServiceImpl(), 9090);
```

Then, you can create a client for it:
```
import { TestService } from './TestService';

const client = await createClient<TestService>(9090, "test");
console.log(await client.test()); // 42
```

## Important

In order to be able to generate stub methods for the object, you have to pass all the method names to `createClient`, like we did in the example.

This is required, because JS does not have any runtime information about TypeScript interfaces.

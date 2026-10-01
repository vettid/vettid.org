import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';
import { ApiFunction, ApiFunctionProps } from './api-function';

export interface HttpRouteGroupProps extends ApiFunctionProps {
  readonly api: apigwv2.HttpApi;
  /**
   * Path prefix this group owns, e.g. '/api/account'. The group receives
   * `ANY <prefix>` and `ANY <prefix>/{proxy+}`; the handler routes internally.
   */
  readonly pathPrefix: string;
}

/**
 * One Lambda serving a whole group of related routes on an HTTP API.
 *
 * vettid-dev defined one function per route (~7 CloudFormation resources
 * each), which pushed stacks past the 500-resource limit and forced them to
 * be split by resource count instead of by domain. A route group costs the
 * same handful of resources whether it serves 2 routes or 20.
 *
 * Authorization is done in the handler (JWT verified in code), so no
 * authorizer resource is shared across stacks.
 */
export class HttpRouteGroup extends Construct {
  readonly fn: ApiFunction['fn'];

  constructor(scope: Construct, id: string, props: HttpRouteGroupProps) {
    super(scope, id);
    const { api, pathPrefix, ...fnProps } = props;
    if (!/^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(pathPrefix)) {
      throw new Error(`Invalid pathPrefix "${pathPrefix}": expected /lowercase-segments with no trailing slash`);
    }

    this.fn = new ApiFunction(this, 'Function', fnProps).fn;
    const integration = new integrations.HttpLambdaIntegration('Integration', this.fn);

    api.addRoutes({ path: pathPrefix, methods: [apigwv2.HttpMethod.ANY], integration });
    api.addRoutes({ path: `${pathPrefix}/{proxy+}`, methods: [apigwv2.HttpMethod.ANY], integration });
  }
}

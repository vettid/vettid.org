import * as apigw from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';
import { ApiFunction, ApiFunctionProps } from './api-function';

export interface RestRouteGroupProps extends ApiFunctionProps {
  readonly api: apigw.RestApi;
  /** Path prefixes this group owns, e.g. ['/admin/members', '/admin/invites']. */
  readonly pathPrefixes: string[];
  readonly authorizer: apigw.IAuthorizer;
}

/**
 * REST API counterpart of HttpRouteGroup: one Lambda answering
 * `ANY <prefix>` and `ANY <prefix>/{proxy+}` for each of its prefixes, with
 * the given authorizer on every method. One shared Lambda permission (not one
 * per method) keeps the resource count flat as routes grow.
 *
 * Used for the admin API, which needs a REST API for its IP-restricting
 * resource policy (HTTP APIs have none).
 */
export class RestRouteGroup extends Construct {
  readonly fn: ApiFunction['fn'];

  constructor(scope: Construct, id: string, props: RestRouteGroupProps) {
    super(scope, id);
    const { api, pathPrefixes, authorizer, ...fnProps } = props;
    for (const p of pathPrefixes) {
      if (!/^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(p)) {
        throw new Error(`Invalid path prefix "${p}": expected /lowercase-segments with no trailing slash`);
      }
    }

    this.fn = new ApiFunction(this, 'Function', fnProps).fn;
    const integration = new apigw.LambdaIntegration(this.fn, { proxy: true, allowTestInvoke: false, scopePermissionToMethod: false });
    const methodOptions: apigw.MethodOptions = { authorizer, authorizationType: apigw.AuthorizationType.COGNITO };

    for (const p of pathPrefixes) {
      const resource = api.root.resourceForPath(p);
      resource.addMethod('ANY', integration, methodOptions);
      resource.addResource('{proxy+}').addMethod('ANY', integration, methodOptions);
    }
  }
}

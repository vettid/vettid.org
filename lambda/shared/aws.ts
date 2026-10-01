import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { S3Client } from '@aws-sdk/client-s3';

// One client of each per container, created at cold start.
export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
export const cognito = new CognitoIdentityProviderClient({});
export const ses = new SESv2Client({});
export const s3 = new S3Client({});

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

/** Physical table names are fixed (`vettid-org-<thing>`), passed in as env. */
export const table = {
  members: () => env('TABLE_MEMBERS'),
  invites: () => env('TABLE_INVITES'),
  terms: () => env('TABLE_TERMS'),
  subscriptions: () => env('TABLE_SUBSCRIPTIONS'),
  subscriptionTypes: () => env('TABLE_SUBSCRIPTION_TYPES'),
  audit: () => env('TABLE_AUDIT'),
};

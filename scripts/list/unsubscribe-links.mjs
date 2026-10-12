#!/usr/bin/env node
// The mailing list's unsubscribe tokens, for the operator (RUNBOOK "Mailing
// list"). Reads the production table with the caller's AWS credentials.
//
//   node scripts/list/unsubscribe-links.mjs            give every confirmed
//                                                      subscriber a token if
//                                                      they have none; print
//                                                      counts only
//   node scripts/list/unsubscribe-links.mjs --links    the same, then print
//                                                      one line per
//                                                      subscriber:
//                                                      address, page link,
//                                                      one-click link (tab
//                                                      separated), for a
//                                                      mailing
//
// Subscribers confirmed before unsubscribe existed have no token until this
// runs (or until a mailing built with listMessage() asks for one): run it
// once after the deploy, and again right before any mailing. It is safe to
// repeat: a token, once set, is never replaced.
// --links prints addresses and tokens: to a terminal or a pipe, never a log.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ensureUnsubscribeToken, unsubscribeOneClickUrl, unsubscribePageUrl } from '../../lambda/signup/list-mail.mjs';

const TABLE = process.env.TABLE_NAME ?? 'vettid-org-mailing-list';
const LINKS = process.argv.includes('--links');
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' }));

let confirmed = 0;
let created = 0;
let gone = 0;
let start;
do {
  const page = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'status-index',
    KeyConditionExpression: '#s = :c',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':c': 'confirmed' },
    ExclusiveStartKey: start,
  }));
  for (const row of page.Items ?? []) {
    let token = row.unsubToken;
    if (!token) {
      token = await ensureUnsubscribeToken(ddb, TABLE, row.email);
      if (!token) { gone += 1; continue; } // unsubscribed since the query
      created += 1;
    }
    confirmed += 1;
    if (LINKS) console.log([row.email, unsubscribePageUrl(token), unsubscribeOneClickUrl(token)].join('\t'));
  }
  start = page.LastEvaluatedKey;
} while (start);

console.error(`confirmed subscribers: ${confirmed}; tokens created now: ${created}; gone meanwhile: ${gone}`);

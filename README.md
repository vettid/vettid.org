# VettID.org - AWS Static Site Infrastructure

This project contains the AWS CDK infrastructure code to host vettid.org as a static website on S3, delivered via CloudFront with HTTPS.

## Architecture

- **S3 Bucket**: Stores static website files
- **CloudFront**: CDN for fast global content delivery
- **ACM Certificate**: SSL/TLS certificate for HTTPS
- **Origin Access Identity**: Secures S3 bucket access to CloudFront only

## Prerequisites

1. AWS CLI configured with appropriate credentials:
   ```bash
   aws configure
   ```

2. Node.js and npm installed (already confirmed)

3. AWS CDK CLI installed (already installed globally)

## Deployment Steps

### Step 1: Bootstrap CDK (First Time Only)

If you haven't used CDK in your AWS account/region before, bootstrap it:

```bash
npx cdk bootstrap aws://ACCOUNT-NUMBER/us-east-1
```

Replace `ACCOUNT-NUMBER` with your AWS account ID. You can find it by running:
```bash
aws sts get-caller-identity --query Account --output text
```

### Step 2: Export Your WordPress Site to Static HTML

Before deploying, you need to export your WordPress site as static HTML files. You have several options:

#### Option A: Using Simply Static Plugin (Recommended)
1. Install the "Simply Static" plugin in WordPress
2. Configure it to export your entire site
3. Download the generated static HTML files
4. Extract and copy all files to the `website/` directory

#### Option B: Using WP2Static Plugin
1. Install "WP2Static" plugin
2. Configure export settings
3. Export and download the static site
4. Copy files to the `website/` directory

#### Option C: Using HTTrack (Website Copier)
```bash
httrack https://www.vettid.org -O ./website
```

**Important**: After exporting, replace the placeholder files in the `website/` directory with your actual WordPress export.

### Step 3: Review and Deploy

1. Review what will be deployed:
   ```bash
   npx cdk diff
   ```

2. Deploy the infrastructure:
   ```bash
   npx cdk deploy
   ```

   This will:
   - Create the S3 bucket
   - Create the ACM certificate
   - Create the CloudFront distribution
   - Upload your website files

### Step 4: Validate SSL Certificate

Since your domain is not in Route53, you need to manually validate the SSL certificate:

1. After deployment completes, note the `CertificateArn` from the output
2. Go to AWS Certificate Manager console (us-east-1 region)
3. Find your certificate and view the DNS validation records
4. Add the CNAME records to your domain's DNS (wherever you manage vettid.org DNS)
5. Wait for validation (can take a few minutes to hours)

### Step 5: Update DNS Records

Once the certificate is validated:

1. Note the `DistributionDomainName` from the CDK output (e.g., `d123456789.cloudfront.net`)
2. In your DNS provider, update the following records:

   **For apex domain (vettid.org):**
   - Type: A or ALIAS (if supported)
   - Name: @ or vettid.org
   - Value: CloudFront distribution domain name
   - If your DNS provider doesn't support ALIAS for apex domains, you may need to use a CNAME for www and redirect apex to www

   **For www subdomain:**
   - Type: CNAME
   - Name: www
   - Value: CloudFront distribution domain name

### Step 6: Verify

After DNS propagates (usually 5-60 minutes):
1. Visit https://vettid.org
2. Visit https://www.vettid.org
3. Both should load with a valid SSL certificate

## Updating Website Content

After the initial deployment, to update website content:

1. Update files in the `website/` directory
2. Deploy changes:
   ```bash
   npx cdk deploy
   ```

The deployment will automatically:
- Upload new/changed files to S3
- Invalidate the CloudFront cache
- Make changes live globally

## Configuration

### Deploying Without Custom Domain (Testing)

If you want to test without setting up the custom domain first:

1. Edit `bin/vettid.org.ts`
2. Change `enableCustomDomain: true` to `enableCustomDomain: false`
3. Deploy with `npx cdk deploy`
4. Access your site via the CloudFront domain name only

### Customizing the Stack

Key configuration in `bin/vettid.org.ts`:
- `domainName`: Your domain name
- `enableCustomDomain`: Enable/disable custom domain and certificate
- `env.region`: Must be `us-east-1` for CloudFront + ACM

## Useful CDK Commands

- `npm run build` - Compile TypeScript to JavaScript
- `npm run watch` - Watch for changes and compile
- `npx cdk diff` - Compare deployed stack with current state
- `npx cdk synth` - Synthesize CloudFormation template
- `npx cdk deploy` - Deploy the stack
- `npx cdk destroy` - Remove all resources (WARNING: deletes everything)

## Stack Outputs

After deployment, you'll see these outputs:

- **CertificateArn**: ARN of the SSL certificate (check ACM console for validation)
- **DistributionDomainName**: CloudFront domain name to use in DNS
- **DistributionId**: CloudFront distribution ID
- **BucketName**: S3 bucket name

## Cost Estimate

Approximate monthly costs (varies by traffic):
- S3 storage: ~$0.023 per GB
- CloudFront: First 10TB free tier, then ~$0.085 per GB
- ACM Certificate: **FREE**
- Data transfer: Included in CloudFront pricing

For a small website with moderate traffic, expect $1-10/month.

## Troubleshooting

### Certificate Validation Pending
- Check ACM console for DNS validation records
- Ensure CNAME records are added correctly to your DNS
- DNS changes can take up to 48 hours to propagate

### Site Not Loading
- Verify DNS records point to CloudFront distribution
- Check CloudFront distribution status (must be "Deployed")
- Clear browser cache or try incognito mode

### 403 Forbidden Errors
- Ensure `index.html` exists in the website directory
- Check CloudFront origin settings
- Verify S3 bucket policy allows CloudFront access

## Security Features

- S3 bucket blocks all public access
- Content only accessible via CloudFront (OAI)
- Encryption at rest (S3) and in transit (HTTPS)
- Bucket versioning enabled
- HTTPS enforced (HTTP redirects to HTTPS)

## Support

For issues with:
- AWS CDK: https://github.com/aws/aws-cdk/issues
- This infrastructure: Review CDK documentation or AWS support

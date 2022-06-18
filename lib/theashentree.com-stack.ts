import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3Deployment from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager'
import { SubjectAlternativeNames } from 'aws-cdk-lib/aws-appmesh';

export class TheashentreeComStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const hostedZone = route53.HostedZone.fromLookup(this, 'raceteamtv.com', {domainName: 'raceteamtv.com'})

    const acmCertificate = new acm.DnsValidatedCertificate(this, 'Certificate', {
      domainName: '*.raceteamtv.com',
      hostedZone: hostedZone,
      subjectAlternativeNames: ['raceteamtv.com']
    });

    const s3Bucket = new s3.Bucket(this, 'StaticWebsite', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      accessControl: s3.BucketAccessControl.PRIVATE,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL
    });

    const accessIdentity = new cloudfront.OriginAccessIdentity(this, 'CloudfrontAccess');
    const cloudfrontUserAccessPolicy = new iam.PolicyStatement();
    cloudfrontUserAccessPolicy.addActions('s3:GetObject');
    cloudfrontUserAccessPolicy.addPrincipals(accessIdentity.grantPrincipal);
    cloudfrontUserAccessPolicy.addResources(s3Bucket.arnForObjects('*'));
    s3Bucket.addToResourcePolicy(cloudfrontUserAccessPolicy);

    const ROOT_INDEX_FILE = 'index.html';
    const PROD_FOLDER = 'production';
    const distribution = new cloudfront.CloudFrontWebDistribution(this, 'Distribution', {
      comment: 'CDK Cloudfront Secure S3',
      viewerCertificate: cloudfront.ViewerCertificate.fromAcmCertificate(acmCertificate, {
        aliases: ['raceteamtv.com', 'www.raceteamtv.com'],
      }),
      defaultRootObject: ROOT_INDEX_FILE,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      httpVersion: cloudfront.HttpVersion.HTTP2,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // the cheapest
      originConfigs: [
        {
          s3OriginSource: {
            originAccessIdentity: accessIdentity,
            s3BucketSource: s3Bucket,
            // originPath: `/${PROD_FOLDER}`,
          },
          behaviors: [
            {
              compress: true,
              isDefaultBehavior: true,
            },
          ],
        },
      ],
      // Allows React to handle all errors internally
      // errorConfigurations: [
      //   {
      //     errorCachingMinTtl: 300, // in seconds
      //     errorCode: 403,
      //     responseCode: 200,
      //     responsePagePath: `/${ROOT_INDEX_FILE}`,
      //   },
      //   {
      //     errorCachingMinTtl: 300, // in seconds
      //     errorCode: 404,
      //     responseCode: 200,
      //     responsePagePath: `/${ROOT_INDEX_FILE}`,
      //   },
      // ],
    });

  
    const deployment = new s3Deployment.BucketDeployment(this, 'SiteDeployment', {
      sources: [s3Deployment.Source.asset('./website')],
      destinationBucket: s3Bucket,
    });

    ['raceteamtv.com', 'www.raceteamtv.com'].forEach(domain => {
      new route53.AaaaRecord(this, `AAA Record for ${domain}`, {
        zone: hostedZone,
        target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution))
      });
  
      new route53.ARecord(this, `A Record for ${domain}`, {
        zone: hostedZone,
        target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution))
      });
    });
  }
}

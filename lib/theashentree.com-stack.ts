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

    const hostedZone = route53.HostedZone.fromLookup(this, 'theashentree.com', {domainName: 'theashentree.com'})

    const acmCertificate = new acm.DnsValidatedCertificate(this, 'Certificate', {
      domainName: '*.theashentree.com',
      hostedZone: hostedZone,
      subjectAlternativeNames: ['theashentree.com']
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

    const distribution = new cloudfront.CloudFrontWebDistribution(this, 'Distribution', {
      comment: 'CDK Cloudfront Secure S3',
      viewerCertificate: cloudfront.ViewerCertificate.fromAcmCertificate(acmCertificate, {
        aliases: ['theashentree.com', 'www.theashentree.com'],
      }),
      defaultRootObject: 'index.html',
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      httpVersion: cloudfront.HttpVersion.HTTP2,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // the cheapest
      originConfigs: [
        {
          s3OriginSource: {
            originAccessIdentity: accessIdentity,
            s3BucketSource: s3Bucket,
          },
          behaviors: [
            {
              compress: true,
              isDefaultBehavior: true,
            },
          ],
        },
      ],
    });

    const deployment = new s3Deployment.BucketDeployment(this, 'SiteDeployment', {
      sources: [s3Deployment.Source.asset('./website')],
      destinationBucket: s3Bucket,
    });

    ['theashentree.com', 'www.theashentree.com'].forEach(domain => {
      new route53.AaaaRecord(this, `AAA Record for ${domain}`, {
        zone: hostedZone,
        recordName: domain,
        target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution))
      });
  
      new route53.ARecord(this, `A Record for ${domain}`, {
        zone: hostedZone,
        recordName: domain,
        target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution))
      });
    });
  }
}

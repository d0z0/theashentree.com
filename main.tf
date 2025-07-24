provider "aws" {
  region = "us-east-1"
}

# 1. Lookup existing hosted zone
data "aws_route53_zone" "hosted_zone" {
  name         = "theashentree.com"
  private_zone = false
}

# 2. ACM certificate (wildcard + root)
resource "aws_acm_certificate" "cert" {
  provider                  = aws
  domain_name               = "*.theashentree.com"
  subject_alternative_names = ["theashentree.com"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# 3. DNS validation records
resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.cert.domain_validation_options :
    dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }

  zone_id = data.aws_route53_zone.hosted_zone.zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60

  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "cert_validation_complete" {
  certificate_arn         = aws_acm_certificate.cert.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

# 4. S3 bucket (private)
resource "aws_s3_bucket" "static_website" {
  bucket        = "theashentree-com-static"
  force_destroy = true
}

# resource "aws_s3_bucket_acl" "static_website" {
#   bucket = aws_s3_bucket.static_website.id
#   acl    = "private"
# }

resource "aws_s3_bucket_server_side_encryption_configuration" "static_website" {
  bucket = aws_s3_bucket.static_website.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "static_website" {
  bucket = aws_s3_bucket.static_website.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# 5. CloudFront origin access control and distribution
resource "aws_cloudfront_origin_access_control" "oac" {
  name                              = "static-site-oac-${aws_s3_bucket.static_website.bucket}"
  origin_access_control_origin_type = "s3"
  signing_protocol                  = "sigv4"
  signing_behavior                  = "always"
}

resource "aws_cloudfront_distribution" "cdn" {
  enabled             = true
  comment             = "Terraform CloudFront Secure S3"
  default_root_object = "index.html"

  aliases = [
    "theashentree.com",
    "www.theashentree.com",
  ]

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate.cert.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  default_cache_behavior {
    target_origin_id       = "s3-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6" # AWS managed CachingOptimized
  }

  origin {
    domain_name = aws_s3_bucket.static_website.bucket_regional_domain_name
    origin_id   = "s3-origin"

    origin_access_control_id = aws_cloudfront_origin_access_control.oac.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "whitelist"
      locations        = ["IN", "GB"] # ISO 3166-1 alpha-2 country code for India
    }
  }

  price_class  = "PriceClass_100"
  http_version = "http2"
}

# 6. Route53 A and AAAA records for both domains pointing to CF
resource "aws_route53_record" "www_alias" {
  for_each = toset([
    "theashentree.com",
    "www.theashentree.com",
  ])

  zone_id = data.aws_route53_zone.hosted_zone.zone_id
  name    = each.value
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.cdn.domain_name
    zone_id                = aws_cloudfront_distribution.cdn.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "www_alias_aaaa" {
  for_each = aws_route53_record.www_alias

  zone_id = data.aws_route53_zone.hosted_zone.zone_id
  name    = each.value.name
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.cdn.domain_name
    zone_id                = aws_cloudfront_distribution.cdn.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_s3_bucket_policy" "static_website_policy" {
  bucket = aws_s3_bucket.static_website.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontOACRead"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.static_website.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.cdn.arn
          }
        }
      }
    ]
  })
}

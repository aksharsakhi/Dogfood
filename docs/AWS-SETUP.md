# AWS EC2 Provisioning & Setup Guide

This guide documents the exact steps used to provision and run Dogfood on Amazon Web Services (AWS) Elastic Compute Cloud (EC2).

## Instance Specifications

- **Cloud Provider**: Amazon Web Services (AWS)
- **Region**: `eu-north-1` (Europe - Stockholm)
- **Instance Type**: `t3.micro` / `t3.small` (General Purpose, 2 vCPUs)
- **Operating System**: Ubuntu Server 24.04 LTS (x86_64)
- **Root Block Device**: 30 GiB General Purpose SSD (`gp3`), 3000 IOPS, 125 MiB/s throughput
- **Swap Memory**: 1.5 GiB active swapfile (`/swapfile`)

## Security Group Configuration

The instance security group (`launch-wizard-1`) allows inbound connections on the following ports:

| Port | Protocol | Source | Description |
| :--- | :--- | :--- | :--- |
| **22** | TCP | `0.0.0.0/0` | Secure Shell (SSH) remote administrative access |
| **80** | TCP | `0.0.0.0/0` | HTTP traffic (routed via Nginx reverse proxy) |
| **443** | TCP | `0.0.0.0/0` | HTTPS secure web traffic |

## EBS Storage Expansion

When launching an EC2 instance with the default 8 GiB volume, multi-stage Docker builds can run out of disk space during layer extraction. Expanding to 30 GiB (within the AWS Free Tier limit) is accomplished on-the-fly:

1. Modify the volume size to 30 GiB in the AWS EC2 Management Console.
2. Extend the partition and online filesystem without rebooting:
   ```bash
   sudo growpart /dev/nvme0n1 1
   sudo resize2fs /dev/nvme0n1p1
   ```
3. Verify the expanded capacity:
   ```bash
   df -h /
   ```

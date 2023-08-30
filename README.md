# report-action

Github actions to trigger report generation for runtime security.

## Learn More

- [About Kubearmor](https://github.com/kubearmor/KubeArmor)
- [About Discovery Engine](https://github.com/accuknox/discovery-engine)

## Inputs

```yaml
inputs:
  baseline-report-path:
    description: 'baseline report path'
    required: true
    default: "baseline/report.json"

  labels:
    description: 'labels. possible value: kubearmor-app: kubearmor-relay'
    required: false
    default: ""

  operation:
    description: 'operation. possible values: process, file, network, syscall'
    required: false
    default: ""

  container-name:
    description: 'container name'
    required: false
    default: ""

  namespaces:
    description: 'namespaces'
    required: false
    default: ""

  workloads:
    description: 'workloads. possible values: deployment/mysql, statefulsets/vault, deployment/*'
    required: false
    default: ""

  source:
    description: 'source'
    required: false
    default: ""

  process-ignore-paths:
    description: 'process ignore paths. possible value: /sbin '
    required: false
    default: ""

  file-ignore-paths:
    description: 'file ignore paths. possible value: /sbin '
    required: false
    default: ""

  ignore-return-code:
    description: 'ignore return code. possible values: true/false'
    required: false
    default: ""

  view:
    description: 'view type. possible value: tabular'
    required: false
    default: "tabular"

```

## Usage

Steps for using install-action in a workflow yaml file 
- Checkout into the repo using checkout action.
- Set up a k8's cluster.
- Use accuknox-install action to install Kubearmor and Discovery Engine.
- Use accuknox-report action to generate report using Kubearmor and Discovery Engine.

### Generate report at specific path

```yaml
- name: accuknox-report
  uses: accuknox/report-action@v0.1.2
  with:
    baseline-report-path: "baseline/report.json"
             
```


## Sample Configuration

```yaml
name: learn-accuknox-report-action
on:
  pull_request:
    branches: [main]
    types: [opened, synchronize, reopened]
  push:
    branches: [main]
jobs:
  check-working:
    runs-on: ubuntu-latest
    steps:
        - name: Checkout repo
          uses: actions/checkout@v3
          with:
            submodules: true
            
        - name: Checkout kubearmor repo
          uses: actions/checkout@v3
          with:
            repository: kubearmor/KubeArmor
            ref: main
            path: Kubearmor
  
        - name: Setup a Kubernetes environment
          run: |
            ./Kubearmor/contribution/k3s/install_k3s.sh
             sudo apt install socat
        
        - name: Install accuknoxcli, KubeArmor and Discovery Engine
          uses: accuknox/install-action@v0.1.1 
 
        - name: Generate Report
          uses: accuknox/report-action@v0.1.2

```

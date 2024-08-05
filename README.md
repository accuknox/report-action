# CI Security by AccuKnox

## Introduction
Report action by AccuKnox is powered by [KubeArmor (a CNCF project)](kubearmor.io), which
watches over all the events taking place in your CI. 

This helps developer build with confidence and make sure that they are aware of all the events
taking place in the CI pipelines. KubeArmor uses revolutionary eBPF monitoring to accurately 
sense all the kernel level events such as network calls, system calls, and file system behaviour. 

This helps you protect against the attacks targeted towards your supply chain, throughout the time
such attacks have had extreme impacts on software, such as SolarWinds and CodeCov attacks. 

## Getting Started
Getting your CI security up by a notch is as simple as introducing two extra lines in your
GitHub action workflow. You only have to add the `report-action` as a part of workflow.

```
uses: accuknox/report-action
```

This action uses NodeJS based workflow powered by GitHub where we take care of looking over your
CI and let you see everything going on in your CI workflow at each step. 

## Report
The report is available to you at the end of each action as a summary, and each summary will have 
two parts, that includes:

1) Network Events: 
This includes a table that gives you an overview of all the networking related events taking place
and you will be able to properly take a look at the protocols, network flow, IP address etc. helps
you to identify malicious network call that might take place. 

2) Process:
You can watch over the process tree which is helpful in system forensics, specially letting you 
clearly see what processes have been spawned in proper manner and assess anything related to process
level events.

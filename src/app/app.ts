import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import mermaid from 'mermaid';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  constructor() {











    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      htmlLabels: false,
      flowchart: {
        htmlLabels: false,
        padding: 20,



        subGraphTitleMargin: { top: 22, bottom: 22 },





        nodeSpacing: 60,
        rankSpacing: 110,
      },
      theme: 'base',
      themeVariables: {



        fontSize: '15px',



        fontFamily: '"Inter", system-ui, sans-serif',





        background: '#ffffff',









        fontColor: '#0f172a',
        textColor: '#0f172a',







        clusterBkgPadding: 20,
        clusterPadding: 12,
        nodePadding: 16,
      },
    });
  }
}

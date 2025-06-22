/**
 * Analysis Controller for LLM-Powered Switch Analysis
 *
 * This controller handles incoming analysis requests, orchestrates calls to services,
 * and returns structured JSON responses for the switch analysis feature.
 */

import { Request, Response } from 'express';

import { AnalysisService } from '../services/analysis.js';

export class AnalysisController {
  private analysisService: AnalysisService;

  constructor() {
    this.analysisService = new AnalysisService();
  }

  async analyzeQuery(req: Request, res: Response): Promise<void> {
    try {
      const { query } = req.body;

      if (!query || typeof query !== 'string') {
        res.status(400).json({ error: 'Query is required and must be a string' });
        return;
      }

      const result = await this.analysisService.performAnalysis(query);

      res.status(200).json({
        success: true,
        analysis: result
      });
    } catch (error: any) {
      console.error('Analysis error:', error.message);
      res.status(500).json({
        success: false,
        error: 'Analysis failed',
        message: error.message
      });
    }
  }
}

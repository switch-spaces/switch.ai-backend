/**
 * Analysis Routes for LLM-Powered Switch Analysis
 *
 * This file defines the API endpoints for the switch analysis feature,
 * including query processing, intent recognition, and service health checks.
 *
 * Base URL: /api/analysis
 *
 * Endpoints:
 * - POST /query - Main analysis endpoint for user queries
 * - POST /intent - Intent recognition only (for debugging/testing)
 * - GET /health - Service health check
 * - GET /config - Service configuration details
 * - GET /test - Test endpoint for development
 */

import { Router } from 'express';

import { AnalysisController } from '../controllers/analysis.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
const analysisController = new AnalysisController();

router.post('/query', authMiddleware, analysisController.analyzeQuery.bind(analysisController));

export default router;

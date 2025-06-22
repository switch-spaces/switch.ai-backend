import {
  CASE_1_TEMPLATE,
  CASE_2_TEMPLATE,
  CASE_3_TEMPLATE,
  CASE_4_TEMPLATE,
  CASE_5_TEMPLATE,
  CASE_6_TEMPLATE,
  UNIVERSAL_FRAMEWORK_INSTRUCTIONS
} from '../config/prompts.js';
import { DatabaseService } from './db.js';
import { LLMFactory } from './llm.factory.js';

/**
 * AnalysisService - Core service for the Switch Expert Analysis Engine
 *
 * This service handles query classification, entity extraction, database retrieval,
 * and generates expert analysis responses using various prompt templates.
 */
export class AnalysisService {
  private databaseService: DatabaseService;

  constructor() {
    this.databaseService = new DatabaseService();
  }

  /**
   * Primary public method for performing switch analysis
   * Serves as the main entry point for all analysis requests
   *
   * @param query - The user's natural language query about switches or materials
   * @returns Promise<string> - The generated analysis response in Markdown format
   */
  async performAnalysis(query: string): Promise<string> {
    const classification = await this.classifyQuery(query);

    switch (classification.case) {
      case 'SingleSwitchAnalysis':
        return await this.handleSingleSwitchAnalysis(classification.entities);
      case 'MultipleSwitchComparison':
        return await this.handleMultipleSwitchComparison(classification.entities);
      case 'SingleMaterialAnalysis':
        return await this.handleSingleMaterialAnalysis(classification.entities);
      case 'MultipleMaterialComparison':
        return await this.handleMultipleMaterialComparison(classification.entities);
      case 'GeneralRecommendation':
        return await this.handleGeneralRecommendation(classification.entities);
      case 'SpringAnalysis':
        return await this.handleSpringAnalysis(classification.entities);
      default:
        throw new Error(`Analysis case ${classification.case} not yet implemented`);
    }
  }

  /**
   * Private method to classify the user query and extract relevant entities
   * Determines which analysis case applies and extracts entity information
   *
   * @param query - The user's natural language query
   * @returns Promise<{ case: string; entities: any; }> - Classification result with case type and extracted entities
   */
  private async classifyQuery(query: string): Promise<{ case: string; entities: any }> {
    const llmService = LLMFactory.getInstance();

    const classificationPrompt = `
You are an expert system for analyzing user queries about mechanical keyboard switches and materials.

Your task is to classify the user query into one of these 6 cases and extract relevant entities:

**Cases:**
1. SingleSwitchAnalysis - User asks about a single specific switch
2. MultipleSwitchComparison - User wants to compare 2+ specific switches
3. SingleMaterialAnalysis - User asks about a single material/component
4. MultipleMaterialComparison - User wants to compare 2+ materials/components
5. GeneralRecommendation - User wants general recommendations or advice
6. SpringAnalysis - User asks general questions about springs (e.g., spring length, weight, progressive vs. linear) and their impact on feel, sound, or longevity

**User Query:** "${query}"

Please respond with a JSON object in this exact format:
{
  "case": "SingleSwitchAnalysis|MultipleSwitchComparison|SingleMaterialAnalysis|MultipleMaterialComparison|GeneralRecommendation|SpringAnalysis",
  "entities": {
    "switchNames": ["array of switch names if applicable"],
    "materials": ["array of material names if applicable"],
    "descriptors": ["array of descriptive terms, preferences, or requirements"],
    "intent": "brief description of what the user wants to know"
  }
}

Examples:
- "Tell me about Cherry MX Blue switches" → {"case": "SingleSwitchAnalysis", "entities": {"switchNames": ["Cherry MX Blue"], "materials": [], "descriptors": [], "intent": "general information about Cherry MX Blue"}}
- "Compare Gateron Yellow vs Kailh Red" → {"case": "MultipleSwitchComparison", "entities": {"switchNames": ["Gateron Yellow", "Kailh Red"], "materials": [], "descriptors": [], "intent": "comparison between two switches"}}
- "What's the difference between ABS and PBT keycaps?" → {"case": "MultipleMaterialComparison", "entities": {"switchNames": [], "materials": ["ABS", "PBT"], "descriptors": ["keycaps"], "intent": "comparison between keycap materials"}}
- "How do longer springs affect switch feel and sound?" → {"case": "SpringAnalysis", "entities": {"switchNames": [], "materials": [], "descriptors": ["springs", "feel", "sound"], "intent": "impact of spring length on feel and sound"}}

Respond only with the JSON object.`;

    try {
      const rawResponse = await llmService.generate(classificationPrompt);

      const cleanedResponse = (() => {
        const trimmed = rawResponse.trim();
        if (trimmed.startsWith('```')) {
          const withoutOpening = trimmed.replace(/^```[a-zA-Z]*\s*/u, '');
          return withoutOpening.replace(/```$/u, '').trim();
        }
        return trimmed;
      })();

      let parsedResponse;
      try {
        parsedResponse = JSON.parse(cleanedResponse);
      } catch (jsonError) {
        throw new Error(
          `Failed to parse LLM response as JSON: ${jsonError instanceof Error ? jsonError.message : 'Unknown JSON parsing error'}\nRaw LLM response: ${rawResponse}`
        );
      }

      const validCases = [
        'SingleSwitchAnalysis',
        'MultipleSwitchComparison',
        'SingleMaterialAnalysis',
        'MultipleMaterialComparison',
        'GeneralRecommendation',
        'SpringAnalysis'
      ];

      if (!parsedResponse.case || !validCases.includes(parsedResponse.case)) {
        throw new Error(
          `Query cannot be classified into any supported analysis case. Received case: ${parsedResponse.case || 'undefined'}`
        );
      }

      if (!parsedResponse.entities || typeof parsedResponse.entities !== 'object') {
        throw new Error('Invalid response structure: missing or invalid entities object');
      }

      const entities = {
        switchNames: Array.isArray(parsedResponse.entities.switchNames)
          ? parsedResponse.entities.switchNames
          : [],
        materials: Array.isArray(parsedResponse.entities.materials)
          ? parsedResponse.entities.materials
          : [],
        descriptors: Array.isArray(parsedResponse.entities.descriptors)
          ? parsedResponse.entities.descriptors
          : [],
        intent: parsedResponse.entities.intent || 'No specific intent identified'
      };

      return {
        case: parsedResponse.case,
        entities
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Query classification failed: ${error.message}`);
      }
      throw new Error('Query classification failed due to unknown error');
    }
  }

  private async resolveSwitchEntities(switchNames: string[]): Promise<any[]> {
    if (!switchNames || switchNames.length === 0) {
      return [];
    }

    try {
      const databaseContext = await this.databaseService.fetchSwitchSpecifications(switchNames, {
        confidenceThreshold: 0.7,
        maxSwitchesPerLookup: 10,
        enableEmbeddingSearch: true,
        enableFuzzyMatching: true,
        enableLLMNormalization: true
      });

      const resolvedSwitches = [];
      const notFoundSwitches = [];

      for (const lookupResult of databaseContext.switches) {
        if (lookupResult.found && lookupResult.data) {
          resolvedSwitches.push({
            name: lookupResult.data.switchName,
            manufacturer: lookupResult.data.manufacturer,
            type: lookupResult.data.type,
            topHousing: lookupResult.data.topHousing,
            bottomHousing: lookupResult.data.bottomHousing,
            stem: lookupResult.data.stem,
            mount: lookupResult.data.mount,
            spring: lookupResult.data.spring,
            actuationForce: lookupResult.data.actuationForceG,
            bottomForce: lookupResult.data.bottomOutForceG,
            preTravel: lookupResult.data.preTravelMm,
            totalTravel: lookupResult.data.totalTravelMm,
            factoryLubed: lookupResult.data.factoryLubed,
            additionalNotes: lookupResult.data.additionalNotesDb,
            confidence: lookupResult.confidence,
            originalQuery: lookupResult.normalizedName
          });
        } else {
          notFoundSwitches.push(lookupResult.normalizedName || 'Unknown switch');
        }
      }

      if (notFoundSwitches.length > 0) {
        if (notFoundSwitches.length === 1) {
          throw new Error(
            `I do not have sufficient data to provide a detailed analysis of ${notFoundSwitches[0]}.`
          );
        } else {
          const switchList = notFoundSwitches.join(', ');
          throw new Error(
            `I do not have sufficient data to provide a detailed analysis of ${switchList}.`
          );
        }
      }

      return resolvedSwitches;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to resolve switch entities: ${error.message}`);
      }
      throw new Error('Failed to resolve switch entities due to unknown error');
    }
  }

  private async handleSingleSwitchAnalysis(entities: any): Promise<string> {
    const resolvedSwitches = await this.resolveSwitchEntities(
      Array.isArray(entities?.switchNames) ? entities.switchNames : []
    );
    if (resolvedSwitches.length === 0) {
      throw new Error('No switch data found for analysis');
    }

    const sw = resolvedSwitches[0];

    const specTable = `| Attribute | Value |\n|---|---|\n| Switch Name | ${sw.name} |\n| Manufacturer | ${sw.manufacturer} |\n| Type | ${sw.type} |\n| Top Housing | ${sw.topHousing} |\n| Bottom Housing | ${sw.bottomHousing} |\n| Stem | ${sw.stem} |\n| Mount | ${sw.mount} |\n| Spring | ${sw.spring} |\n| Actuation Force (g) | ${sw.actuationForce} |\n| Bottom Out Force (g) | ${sw.bottomForce} |\n| Pre-Travel (mm) | ${sw.preTravel} |\n| Total Travel (mm) | ${sw.totalTravel} |\n| Factory Lubed | ${sw.factoryLubed} |\n| Additional Notes | ${sw.additionalNotes} |`;

    const populatedTemplate =
      CASE_1_TEMPLATE.replace('{Switch Name}', sw.name) + '\n\n' + specTable;

    const finalPrompt = UNIVERSAL_FRAMEWORK_INSTRUCTIONS + '\n\n' + populatedTemplate;

    const llmService = LLMFactory.getInstance();
    const markdownResponse = await llmService.generate(finalPrompt);

    return markdownResponse;
  }

  private async handleMultipleSwitchComparison(entities: any): Promise<string> {
    if (!Array.isArray(entities?.switchNames) || entities.switchNames.length < 2) {
      throw new Error('Please provide at least two switch names for comparison.');
    }

    // Resolve the first two switch entities (ignore extras beyond two)
    const targetSwitchNames = entities.switchNames.slice(0, 2);
    const resolvedSwitches = await this.resolveSwitchEntities(targetSwitchNames);

    if (resolvedSwitches.length < 2) {
      throw new Error(
        'Unable to retrieve sufficient data for both switches to perform a comparison.'
      );
    }

    const [swA, swB] = resolvedSwitches;

    // Build a comparative specification table
    const comparativeTable = `| Attribute | ${swA.name} | ${swB.name} |
    |---|---|---|
    | Manufacturer | ${swA.manufacturer} | ${swB.manufacturer} |
    | Type | ${swA.type} | ${swB.type} |
    | Top Housing | ${swA.topHousing} | ${swB.topHousing} |
    | Bottom Housing | ${swA.bottomHousing} | ${swB.bottomHousing} |
    | Stem | ${swA.stem} | ${swB.stem} |
    | Mount | ${swA.mount} | ${swB.mount} |
    | Spring | ${swA.spring} | ${swB.spring} |
    | Actuation Force (g) | ${swA.actuationForce} | ${swB.actuationForce} |
    | Bottom Out Force (g) | ${swA.bottomForce} | ${swB.bottomForce} |
    | Pre-Travel (mm) | ${swA.preTravel} | ${swB.preTravel} |
    | Total Travel (mm) | ${swA.totalTravel} | ${swB.totalTravel} |
    | Factory Lubed | ${swA.factoryLubed} | ${swB.factoryLubed} |
    | Additional Notes | ${swA.additionalNotes} | ${swB.additionalNotes} |`;

    const populatedTemplate =
      CASE_2_TEMPLATE.replace('{Switch A}', swA.name).replace('{Switch B}', swB.name) +
      '\n\n' +
      comparativeTable;

    const finalPrompt = UNIVERSAL_FRAMEWORK_INSTRUCTIONS + '\n\n' + populatedTemplate;

    const llmService = LLMFactory.getInstance();
    const markdownResponse = await llmService.generate(finalPrompt);

    return markdownResponse;
  }

  private async handleSingleMaterialAnalysis(entities: any): Promise<string> {
    const materials: string[] = Array.isArray(entities?.materials)
      ? entities.materials.map((m: string) => m.trim()).filter(Boolean)
      : [];

    if (materials.length === 0) {
      throw new Error('Please provide a material name for analysis.');
    }

    const materialName = materials[0];

    const populatedTemplate = CASE_3_TEMPLATE.replace('{Material Name}', materialName);

    const finalPrompt = UNIVERSAL_FRAMEWORK_INSTRUCTIONS + '\n\n' + populatedTemplate;

    const llmService = LLMFactory.getInstance();
    const markdownResponse = await llmService.generate(finalPrompt);

    return markdownResponse;
  }

  private async handleMultipleMaterialComparison(entities: any): Promise<string> {
    const materials: string[] = Array.isArray(entities?.materials)
      ? entities.materials.map((m: string) => m.trim()).filter(Boolean)
      : [];

    if (materials.length < 2) {
      throw new Error('Please provide at least two material names for comparison.');
    }

    const [materialA, materialB] = materials.slice(0, 2);

    const populatedTemplate = CASE_4_TEMPLATE.replace('{Material A}', materialA).replace(
      '{Material B}',
      materialB
    );

    const finalPrompt = `${UNIVERSAL_FRAMEWORK_INSTRUCTIONS}\n\n${populatedTemplate}`;

    const llmService = LLMFactory.getInstance();
    const markdownResponse = await llmService.generate(finalPrompt);

    return markdownResponse;
  }

  private async handleGeneralRecommendation(entities: any): Promise<string> {
    const descriptors: string[] = Array.isArray(entities?.descriptors)
      ? entities.descriptors.map((d: string) => d.trim()).filter(Boolean)
      : [];

    if (descriptors.length === 0) {
      throw new Error(
        'Please provide at least one descriptor (e.g., "thocky", "tactile") to receive general switch recommendations.'
      );
    }

    let descriptorPhrase: string;
    if (descriptors.length === 1) {
      descriptorPhrase = descriptors[0];
    } else if (descriptors.length === 2) {
      descriptorPhrase = `${descriptors[0]} and ${descriptors[1]}`;
    } else {
      descriptorPhrase = `${descriptors.slice(0, -1).join(', ')}, and ${descriptors[descriptors.length - 1]}`;
    }

    const populatedTemplate = CASE_5_TEMPLATE.replace(
      '{Descriptor 1, Descriptor 2, and Descriptor 3}',
      descriptorPhrase
    );

    const finalPrompt = UNIVERSAL_FRAMEWORK_INSTRUCTIONS + '\n\n' + populatedTemplate;

    const llmService = LLMFactory.getInstance();
    const markdownResponse = await llmService.generate(finalPrompt);

    return markdownResponse;
  }

  private async handleSpringAnalysis(entities: any): Promise<string> {
    const descriptors: string[] = Array.isArray(entities?.descriptors)
      ? entities.descriptors.map((d: string) => d.trim()).filter(Boolean)
      : [];

    let descriptorPhrase = descriptors.join(', ');
    if (descriptors.length > 1) {
      descriptorPhrase = `${descriptors.slice(0, -1).join(', ')} and ${descriptors[descriptors.length - 1]}`;
    }

    const llmService = LLMFactory.getInstance();

    const finalPrompt = [
      UNIVERSAL_FRAMEWORK_INSTRUCTIONS,
      CASE_6_TEMPLATE,
      descriptors.length > 0 ? `\nFocus descriptors: ${descriptorPhrase}` : ''
    ].join('\n\n');

    const markdownResponse = await llmService.generate(finalPrompt);
    return markdownResponse;
  }
}

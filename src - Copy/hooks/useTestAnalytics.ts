import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { buildDecisionMetrics, computeScore, QuestionAttempt } from '../lib/analytics-utils';
import {
  buildAggregateHierarchicalAccuracy,
  buildHierarchicalPerformanceReport,
  buildAggregateTestTrends,
  evaluateRepeatedWeaknesses,
  HierarchicalPerformance,
} from '../lib/hierarchical-analytics';

type AttemptPayloadQuestion = {
  question_id?: string;
  questionId?: string;
  selected_answer?: string | null;
  selectedAnswer?: string | null;
  confidence?: string | null;
  difficulty_level?: string | null;
  difficultyLevel?: string | null;
  error_category?: string | null;
  errorCategory?: string | null;
  review_tags?: string[] | null;
  reviewTags?: string[] | null;
  time_spent_seconds?: number | null;
  timeSpentSeconds?: number | null;
};

const normalizeAttemptPayload = (attempt: any): AttemptPayloadQuestion[] => {
  const rawQuestions = attempt?.attempt_payload?.questions;
  if (Array.isArray(rawQuestions)) return rawQuestions;
  if (rawQuestions && typeof rawQuestions === 'object') {
    return Object.entries(rawQuestions).map(([questionId, value]: [string, any]) => ({
      question_id: questionId,
      ...value,
    }));
  }
  return [];
};

const normalizeConfidence = (confidence: string | null | undefined) => {
  const value = String(confidence || '').toLowerCase();
  if (value === 'sure' || value === '100% sure') return '100% Sure';
  if (value === 'logical' || value === 'logical elimination') return 'Logical Elimination';
  if (value === 'guess' || value === 'pure guess') return 'Pure Guess';
  if (value === 'funda' || value === 'upsc funda') return 'UPSC Funda';
  return confidence || undefined;
};

const normalizeDifficulty = (difficulty: string | null | undefined) => {
  const value = String(difficulty || '').toLowerCase();
  if (value === 'easy') return 'Easy';
  if (value === 'medium' || value === 'moderate') return 'Medium';
  if (value === 'hard') return 'Hard';
  return undefined;
};

const buildQuestionAttempts = (rows: AttemptPayloadQuestion[], questionsMeta: Record<string, any>, fallbackTestId?: string) => {
  return rows
    .filter(row => row.question_id || row.questionId)
    .map(row => {
      const questionId = String(row.question_id || row.questionId);
      const meta = questionsMeta[questionId] || {};
      return {
        id: questionId,
        testId: fallbackTestId,
        subject: meta.subject || 'General',
        sectionGroup: meta.section_group || 'General',
        microTopic: meta.micro_topic || 'Unmapped',
        selectedAnswer: row.selected_answer ?? row.selectedAnswer ?? undefined,
        correctAnswer: meta.correct_answer,
        confidence: normalizeConfidence(row.confidence),
        difficultyLevel: normalizeDifficulty(row.difficulty_level ?? row.difficultyLevel),
        errorCategory: row.error_category ?? row.errorCategory ?? undefined,
        reviewTags: row.review_tags ?? row.reviewTags ?? [],
        timeSpentSeconds: Number(row.time_spent_seconds ?? row.timeSpentSeconds ?? 0),
      } as QuestionAttempt;
    });
};

const fetchQuestionsMeta = async (questionIds: string[]) => {
  if (questionIds.length === 0) return {};
  const { data, error } = await supabase
    .from('questions')
    .select('id, subject, section_group, micro_topic, correct_answer, question_text, explanation_markdown')
    .in('id', questionIds);

  if (error) throw error;

  const meta: Record<string, any> = {};
  (data || []).forEach(row => {
    meta[String(row.id)] = row;
  });
  return meta;
};

export function useSingleTestAnalytics(testAttemptId: string | null) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [scoreData, setScoreData] = useState<{
    totalMarks: string;
    accuracy: number;
    attemptQualityScore: number;
    qualityLabel: string;
    correct: number;
    incorrect: number;
    unattempted: number;
    totalTimeSeconds: number;
    avgTimePerQuestion: number;
  } | null>(null);
  const [hierarchicalPerformance, setHierarchicalPerformance] = useState<HierarchicalPerformance | null>(null);
  const [confidenceMetrics, setConfidenceMetrics] = useState<any[]>([]);

  useEffect(() => {
    if (!testAttemptId) {
      setScoreData(null);
      setHierarchicalPerformance(null);
      setConfidenceMetrics([]);
      return;
    }

    const fetchSingleTest = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: attempt, error: attemptError } = await supabase
          .from('test_attempts')
          .select('*')
          .eq('id', testAttemptId)
          .single();
        if (attemptError) throw attemptError;

        let payloadRows = normalizeAttemptPayload(attempt);

        // Fallback for legacy attempts that predate stored payloads.
        if (payloadRows.length === 0) {
          const { data: states, error: statesError } = await supabase
            .from('question_states')
            .select('*')
            .eq('attempt_id', attempt.id)
            .eq('user_id', attempt.user_id);
          if (statesError) throw statesError;
          payloadRows = (states || []).map((state: any) => ({
            question_id: state.question_id,
            selected_answer: state.selected_answer,
            confidence: state.confidence,
            difficulty_level: state.difficulty_level,
            error_category: state.error_category,
            review_tags: state.review_tags,
            time_spent_seconds: state.time_spent_seconds,
          }));
        }

        const questionIds = Array.from(new Set(payloadRows.map(row => String(row.question_id || row.questionId || '')).filter(Boolean)));
        const questionsMeta = await fetchQuestionsMeta(questionIds);
        const questions = buildQuestionAttempts(payloadRows, questionsMeta, attempt.id);

        if (questions.length === 0) {
          setScoreData(null);
          setHierarchicalPerformance(null);
          setConfidenceMetrics([]);
          return;
        }

        const totalTimeSeconds = questions.reduce((sum, question) => sum + (question.timeSpentSeconds || 0), 0);
        const computedScore = computeScore(questions);
        const hierarchy = buildHierarchicalPerformanceReport(questions);
        const confidence = buildDecisionMetrics(questions);

        setScoreData({
          ...computedScore,
          totalTimeSeconds,
          avgTimePerQuestion: questions.length ? Math.round(totalTimeSeconds / questions.length) : 0,
        });
        setHierarchicalPerformance(hierarchy);
        setConfidenceMetrics(confidence);
      } catch (err: any) {
        console.error('[useSingleTestAnalytics] Error:', err);
        setError(err);
      } finally {
        setLoading(false);
      }
    };

    fetchSingleTest();
  }, [testAttemptId]);

  return { loading, error, scoreData, hierarchicalPerformance, confidenceMetrics };
}

export function useAggregateTestAnalytics(userId: string | null) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [trends, setTrends] = useState<{ historicalScores: any[]; negativeMarkingTrends: any[] } | null>(null);
  const [cumulativeHierarchy, setCumulativeHierarchy] = useState<HierarchicalPerformance | null>(null);
  const [repeatedWeaknesses, setRepeatedWeaknesses] = useState<string[]>([]);

  useEffect(() => {
    if (!userId) return;

    const fetchAggregate = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: attempts, error: attemptsError } = await supabase
          .from('test_attempts')
          .select('*')
          .eq('user_id', userId)
          .not('submitted_at', 'is', null)
          .order('submitted_at', { ascending: true });
        if (attemptsError) throw attemptsError;

        const questionIds = Array.from(
          new Set(
            (attempts || [])
              .flatMap((attempt: any) => normalizeAttemptPayload(attempt))
              .map(row => String(row.question_id || row.questionId || ''))
              .filter(Boolean)
          )
        );
        const questionsMeta = await fetchQuestionsMeta(questionIds);

        const allQuestions: QuestionAttempt[] = [];
        const attemptRowsForTrend: any[] = [];

        (attempts || []).forEach((attempt: any) => {
          const rows = normalizeAttemptPayload(attempt);
          const questions = buildQuestionAttempts(rows, questionsMeta, attempt.id);
          allQuestions.push(...questions);

          const computed = questions.length > 0 ? computeScore(questions) : null;
          attemptRowsForTrend.push({
            test_id: attempt.id,
            submitted_at: attempt.submitted_at,
            score: computed ? Number(computed.totalMarks) : (attempt.score || 0),
            accuracy: computed ? computed.accuracy : 0,
            correct_count: computed ? computed.correct : 0,
            incorrect_count: computed ? computed.incorrect : 0,
            unattempted_count: computed ? computed.unattempted : 0,
          });
        });

        setTrends(buildAggregateTestTrends(attemptRowsForTrend));

        if (allQuestions.length === 0) {
          setCumulativeHierarchy(null);
          setRepeatedWeaknesses([]);
          return;
        }

        const cumulative = buildAggregateHierarchicalAccuracy(allQuestions);
        setCumulativeHierarchy(cumulative);
        setRepeatedWeaknesses(evaluateRepeatedWeaknesses(attemptRowsForTrend, allQuestions));
      } catch (err: any) {
        console.error('[useAggregateTestAnalytics] Error:', err);
        setError(err);
      } finally {
        setLoading(false);
      }
    };

    fetchAggregate();
  }, [userId]);

  return { loading, error, trends, cumulativeHierarchy, repeatedWeaknesses };
}

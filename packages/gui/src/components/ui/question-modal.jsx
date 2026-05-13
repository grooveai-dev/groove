// FSL-1.1-Apache-2.0 — see LICENSE
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MessageCircleQuestion, Send } from 'lucide-react';
import { Button } from '../ui/button';
import { useGrooveStore } from '../../stores/groove';

export function QuestionModal() {
  const pendingQuestions = useGrooveStore((s) => s.pendingQuestions);
  const answerQuestion = useGrooveStore((s) => s.answerQuestion);
  const [answers, setAnswers] = useState({});

  if (!pendingQuestions?.length) return null;

  function handleSubmit(q) {
    const questionAnswers = {};
    for (const qItem of q.questions) {
      const key = qItem.question || qItem.header || `q${q.questions.indexOf(qItem)}`;
      questionAnswers[key] = answers[`${q.agentId}:${key}`] || '';
    }
    answerQuestion(q.agentId, questionAnswers);
    setAnswers((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (key.startsWith(q.agentId + ':')) delete next[key];
      }
      return next;
    });
  }

  return (
    <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 w-full max-w-lg flex flex-col gap-2 px-4">
      <AnimatePresence>
        {pendingQuestions.map((q) => (
          <motion.div
            key={q.id}
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="rounded-lg border border-accent/30 bg-surface-2/95 backdrop-blur-md shadow-xl shadow-accent/5 overflow-hidden"
          >
            <div className="px-4 py-3 flex items-start gap-3">
              <MessageCircleQuestion size={16} className="text-accent shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-text-0 font-sans">
                  {q.agentName || 'Agent'} has a question
                </p>
              </div>
            </div>
            <div className="px-4 pb-3 flex flex-col gap-2">
              {q.questions.map((qItem, i) => {
                const key = qItem.question || qItem.header || `q${i}`;
                const inputKey = `${q.agentId}:${key}`;
                return (
                  <div key={i}>
                    <p className="text-2xs text-text-2 font-sans mb-1">{qItem.question || key}</p>
                    {qItem.options?.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {qItem.options.map((opt) => {
                          const label = typeof opt === 'string' ? opt : opt.label;
                          const selected = answers[inputKey] === label;
                          return (
                            <button
                              key={label}
                              onClick={() => setAnswers((p) => ({ ...p, [inputKey]: label }))}
                              className={`px-2 py-1 text-2xs rounded border font-sans transition-colors ${
                                selected
                                  ? 'border-accent bg-accent/20 text-text-0'
                                  : 'border-border-subtle bg-surface-1 text-text-2 hover:border-accent/50'
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <input
                        type="text"
                        className="w-full px-2 py-1.5 text-xs rounded border border-border-subtle bg-surface-1 text-text-0 font-sans placeholder:text-text-3 focus:outline-none focus:border-accent"
                        placeholder="Type your answer..."
                        value={answers[inputKey] || ''}
                        onChange={(e) => setAnswers((p) => ({ ...p, [inputKey]: e.target.value }))}
                        onKeyDown={(e) => e.key === 'Enter' && handleSubmit(q)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="px-4 py-2.5 border-t border-border-subtle flex items-center justify-end">
              <Button
                size="sm"
                variant="accent"
                onClick={() => handleSubmit(q)}
              >
                <Send size={14} className="mr-1" />
                Answer
              </Button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

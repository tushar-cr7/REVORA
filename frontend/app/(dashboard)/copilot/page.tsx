'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Send, Sparkles, Activity, Layers, CornerDownRight } from 'lucide-react';
import { api } from '@/lib/api';
import { CopilotResponse, Opportunity } from '@/lib/types';
import { formatINR, formatPct } from '@/lib/format';
import { motion, AnimatePresence } from 'framer-motion';
import { SectionHeader } from '@/components/ui/SectionHeader';

const QUICK_PROMPTS = [
  'Generate Executive Recovery Briefing',
  'Why are actions being paused?',
  'What are the highest value opportunities?',
  'Analyze recovery trends this week',
];

export default function CopilotPage() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<CopilotResponse[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  
  const bottomRef = useRef<HTMLDivElement>(null);

  const runQuery = useCallback(async (promptText: string, txId?: string) => {
    if (!promptText.trim()) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.queryCopilot(promptText, txId || undefined);
      setHistory((prev) => [...prev, res]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to query Copilot';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    api.getOpportunities(5).then(setOpportunities).catch(() => {});
    runQuery('Executive Briefing');
  }, [runQuery]);
  
  useEffect(() => {
     bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, loading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    runQuery(query);
    setQuery('');
  };

  const handleInspectTx = (txId: string) => {
    runQuery(`Analyze opportunity ${txId}`, txId);
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { 
      opacity: 1,
      transition: { staggerChildren: 0.1 }
    }
  };

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto w-full flex flex-col min-h-[calc(100vh-2rem)] pb-8 relative">
      {/* Background Accent */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-ai-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="flex items-center justify-between relative z-10">
        <div className="flex items-center space-x-3">
          <Sparkles strokeWidth={1.75} className="w-5 h-5 text-text-muted shrink-0" />
          <div>
            <h2 className="text-xl font-semibold text-text-primary tracking-tight">AI Copilot</h2>
            <p className="text-[13px] text-text-muted mt-0.5">Your intelligent assistant for revenue recovery</p>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-lg bg-risk-900/20 border border-risk-500/40 text-risk-400 text-[13px] font-medium flex items-center relative z-10">{errorMsg}</div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 relative z-10">
        {/* Chat Section */}
        <div className="lg:col-span-8 xl:col-span-9 flex flex-col space-y-6 h-full min-h-[600px]">
          
          <div className="flex-1 bg-panel border border-border-strong rounded-xl overflow-hidden shadow-sm flex flex-col relative group">
            {/* Header / Status */}
            <div className="absolute top-0 left-0 right-0 p-3 bg-surface/80 backdrop-blur-md border-b border-border-subtle flex items-center justify-between z-10">
               <div className="flex items-center space-x-2 px-3 py-1 bg-ai-900/20 rounded-full border border-ai-500/20 shadow-inner">
                 <span className="w-1.5 h-1.5 rounded-full bg-ai-400 animate-pulse" />
                 <span className="text-ai-400 uppercase tracking-widest text-[10px] font-bold">Copilot Active</span>
               </div>
               <div className="text-[10px] font-mono text-text-muted uppercase tracking-widest px-3">
                 Session Connected
               </div>
            </div>
            
            {/* Chat History */}
            <div className="pt-16 p-6 flex-1 overflow-y-auto custom-scrollbar flex flex-col space-y-8 bg-gradient-to-b from-panel to-surface">
               <AnimatePresence>
                 {history.map((item, idx) => (
                   <motion.div 
                     key={idx}
                     initial={{ opacity: 0, y: 15 }}
                     animate={{ opacity: 1, y: 0 }}
                     transition={{ duration: 0.3 }}
                     className="space-y-6"
                   >
                     {/* Query Bubble */}
                     <div className="flex justify-end">
                        <div className="bg-text-primary text-canvas border border-text-primary p-4 rounded-2xl rounded-tr-sm max-w-[80%] shadow-md">
                           <div className="text-canvas/60 text-[10px] mb-1.5 tracking-widest uppercase font-bold flex items-center justify-end space-x-2 font-mono">
                              <span>You</span>
                           </div>
                           <div className="text-[14px] font-medium tracking-tight leading-relaxed">
                             {item.query}
                           </div>
                        </div>
                     </div>
     
                     {/* Response Bubble */}
                     <div className="flex justify-start">
                       <div className="bg-panel border border-border-strong p-6 rounded-2xl rounded-tl-sm max-w-[95%] shadow-sm relative overflow-hidden group/response hover:border-ai-500/30 transition-colors">
                         <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-ai-400 to-ai-600 opacity-50 group-hover/response:opacity-100 transition-opacity" />
                         
                         <div className="flex items-start justify-between pb-4 border-b border-border-subtle mb-4">
                           <div className="flex items-center space-x-3">
                              <div className="w-8 h-8 rounded-lg bg-ai-900/10 border border-ai-500/20 flex items-center justify-center shrink-0">
                                <Sparkles className="w-4 h-4 text-ai-400" />
                              </div>
                              <div>
                                 <div className="text-[10px] text-ai-400 tracking-widest uppercase font-bold flex items-center"><Sparkles className="w-3 h-3 mr-1" /> REVORA Copilot</div>
                                 <h3 className="text-[15px] font-semibold text-text-primary mt-0.5 tracking-tight capitalize">{item.headline}</h3>
                              </div>
                           </div>
                         </div>
     
                         <p className="text-text-secondary whitespace-pre-wrap font-sans text-[14px] tracking-wide leading-relaxed">
                           {item.answer}
                         </p>
     
                         {item.key_metrics && Object.keys(item.key_metrics).length > 0 && (
                           <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-5 mt-5 border-t border-border-subtle/50">
                             {Object.entries(item.key_metrics).map(([k, v]) => (
                               <div key={k} className="p-3 bg-surface rounded-lg border border-border-subtle">
                                 <span className="text-[10px] uppercase text-text-muted block truncate tracking-widest font-mono">
                                   {k.replace(/_/g, ' ')}
                                 </span>
                                 <span className="text-[16px] font-display font-bold text-text-primary mt-1 block">
                                   {typeof v === 'number'
                                     ? (k.includes('amount') || k.includes('risk') || k.includes('recovered') || k.includes('value')
                                       ? formatINR(v)
                                       : (k.includes('prob') || k.includes('rate') ? formatPct(v) : v))
                                     : String(v)}
                                 </span>
                               </div>
                             ))}
                           </div>
                         )}
     
                         {item.recommendations && item.recommendations.length > 0 && (
                           <div className="space-y-3 pt-5 mt-5 border-t border-border-subtle/50">
                             <div className="flex items-center space-x-2 text-text-primary text-[12px] font-bold tracking-widest uppercase">
                               <CornerDownRight className="w-4 h-4 text-ai-400" />
                               <span>Recommended Actions</span>
                             </div>
                             <div className="space-y-2">
                               {item.recommendations.map((rec: string, rIdx: number) => (
                                 <div key={rIdx} className="p-3 rounded-lg bg-surface border border-border-subtle text-[13px] text-text-secondary flex items-start space-x-3">
                                   <div className="w-1.5 h-1.5 rounded-full bg-ai-400 mt-1.5 shrink-0" />
                                   <span className="leading-relaxed font-medium">{rec}</span>
                                 </div>
                               ))}
                             </div>
                           </div>
                         )}
                       </div>
                     </div>
                   </motion.div>
                 ))}
               </AnimatePresence>
               
               {loading && (
                 <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex justify-start"
                  >
                     <div className="bg-panel border border-border-strong p-4 rounded-2xl rounded-tl-sm flex items-center space-x-4 shadow-sm relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-1 h-full bg-ai-500" />
                        <Sparkles className="w-5 h-5 text-ai-400 animate-pulse" />
                        <div className="flex items-center space-x-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-ai-400/50 animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-ai-400/50 animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-ai-400/50 animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                     </div>
                 </motion.div>
               )}
               <div ref={bottomRef} className="h-4" />
            </div>
          </div>
          
          {/* Input Area */}
          <div className="bg-panel border border-border-strong rounded-xl p-5 shadow-sm shrink-0">
            <form onSubmit={handleSubmit} className="relative flex items-center">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ask Copilot for analysis, summaries, or strategy recommendations..."
                className="w-full bg-surface border border-border-strong rounded-lg px-5 py-4 text-[14px] text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-ai-500/50 focus:ring-1 focus:ring-ai-500/50 transition-all font-mono"
              />
              <button
                type="submit"
                disabled={loading || !query.trim()}
                className="absolute right-3 px-5 py-2.5 rounded-md bg-text-primary hover:bg-text-secondary disabled:opacity-30 text-canvas text-[12px] font-bold tracking-widest flex items-center space-x-2 transition-all shadow-sm"
              >
                <Send className="w-3.5 h-3.5" />
                <span className="hidden sm:inline uppercase">Send</span>
              </button>
            </form>

            <div className="flex flex-wrap gap-2 pt-4">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => runQuery(prompt)}
                  disabled={loading}
                  className="px-3 py-1.5 rounded-full bg-surface hover:bg-panel-hover border border-border-subtle hover:border-ai-500/50 text-[11px] font-mono text-text-secondary hover:text-ai-400 transition-colors flex items-center space-x-1.5 shadow-sm"
                >
                  <Sparkles className="w-3 h-3 text-ai-500/70" />
                  <span>{prompt}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right Col */}
        <div className="lg:col-span-4 xl:col-span-3 space-y-6">
          {/* How it works */}
          <div className="bg-panel border border-border-strong rounded-xl p-5 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-ai-500/5 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none" />
            <div className="flex items-center space-x-3 pb-4 border-b border-border-subtle mb-4 relative z-10">
              <Sparkles strokeWidth={1.75} className="w-4 h-4 text-text-muted shrink-0" />
              <h3 className="text-[13px] font-semibold text-text-primary tracking-wide">
                Intelligence Engine
              </h3>
            </div>
            <div className="space-y-3 relative z-10">
              {[
                'Analyzes realtime pipeline data & trends.',
                'Identifies highest EV recovery actions.',
                'Validates strategies against safety rules.'
              ].map((text, idx) => (
                <div key={idx} className="p-3 rounded-lg bg-surface border border-border-subtle text-text-secondary flex items-start space-x-3">
                  <div className="w-5 h-5 rounded-full bg-ai-900/20 text-ai-400 flex items-center justify-center shrink-0 font-mono text-[10px] font-bold border border-ai-500/20 mt-0.5">{idx + 1}</div>
                  <span className="leading-relaxed text-[12px]">{text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Opportunities */}
          <div className="bg-panel border border-border-strong rounded-xl flex flex-col h-[400px] lg:h-[500px] shadow-sm overflow-hidden">
            <div className="p-5 border-b border-border-subtle bg-surface/50 flex items-center space-x-3">
              <Activity strokeWidth={1.75} className="w-4 h-4 text-text-muted shrink-0" />
              <div>
                <h3 className="text-[14px] font-medium text-text-primary tracking-wide">Ask about Leak</h3>
                <p className="text-[11px] text-text-muted mt-0.5">Click to analyze specific tx</p>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
              <AnimatePresence>
                {opportunities.map((opp, idx) => (
                  <motion.div
                    key={opp.leak_id}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                  >
                    <button
                      onClick={() => handleInspectTx(opp.transaction_id)}
                      className="w-full text-left p-3 rounded-lg bg-surface hover:bg-panel-hover border border-border-subtle hover:border-primary-500/50 transition-colors group flex flex-col space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] font-mono font-bold text-text-primary group-hover:text-primary-400 transition-colors truncate">
                          {opp.transaction_id}
                        </span>
                        <span className="text-[13px] font-display font-bold text-text-primary shrink-0 ml-2 group-hover:text-primary-400 transition-colors">
                          {formatINR(opp.amount)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-mono text-text-muted">
                        <span className="truncate uppercase tracking-widest">{opp.leak_type.replace(/_/g, ' ')}</span>
                      </div>
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>

              {opportunities.length === 0 && (
                <div className="text-[11px] text-text-disabled text-center p-6 rounded-lg uppercase tracking-widest font-mono">
                  <Activity className="w-6 h-6 mx-auto mb-2 opacity-30" />
                  No opportunities found.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
